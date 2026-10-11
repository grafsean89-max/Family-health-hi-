-- Additive Phase 1 migration. Does not alter the legacy appointment_questions table.
-- Run as the Supabase migration owner, never as an app/browser role.
begin;
create schema fh_private;
revoke all on schema fh_private from public, anon, authenticated;
grant usage on schema fh_private to authenticated;

create table public.fh_patients (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(name) between 1 and 100),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.fh_memberships (
 patient_id uuid not null references public.fh_patients(id),
 user_id uuid not null references auth.users(id),
 role text not null check (role in ('administrator','family_member')),
 created_at timestamptz not null default now(),
 primary key(patient_id,user_id)
);
create index fh_memberships_user on public.fh_memberships(user_id,patient_id);
create table public.fh_invitations (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.fh_patients(id),
 recipient_email text not null check (recipient_email = lower(btrim(recipient_email)) and length(recipient_email) between 3 and 254),
 role text not null check (role in ('administrator','family_member')),
 invited_by uuid not null references auth.users(id),
 expires_at timestamptz not null,
 accepted_by uuid references auth.users(id),
 accepted_at timestamptz,
 cancelled_at timestamptz,
 created_at timestamptz not null default now()
);
create index fh_invitations_patient on public.fh_invitations(patient_id);
create table public.fh_admin_removal_requests (
 id uuid primary key default gen_random_uuid(),
 patient_id uuid not null references public.fh_patients(id),
 requested_by uuid not null references auth.users(id),
 target_user_id uuid not null references auth.users(id),
 action text not null check (action in ('revoke','demote')),
 status text not null default 'pending' check (status in ('pending','completed','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 completed_at timestamptz,
 check (requested_by <> target_user_id)
);
create unique index fh_one_pending_removal on public.fh_admin_removal_requests(patient_id,target_user_id) where status='pending';
create table public.fh_admin_removal_approvals (
 request_id uuid primary key references public.fh_admin_removal_requests(id),
 approved_by uuid not null references auth.users(id),
 approved_at timestamptz not null default now()
);
create table public.fh_audit_events (
 id bigint generated always as identity primary key,
 patient_id uuid not null references public.fh_patients(id),
 actor_id uuid references auth.users(id),
 event text not null,
 object_id uuid,
 subject_user_id uuid,
 happened_at timestamptz not null default now()
);
create index fh_audit_patient on public.fh_audit_events(patient_id,happened_at);
create table public.fh_doctors (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.fh_patients(id),
 name text not null check(length(name) between 1 and 100),specialty text not null default '' check(length(specialty)<=100),
 unique(patient_id,id)
);
create table public.fh_medications (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.fh_patients(id),
 doctor_id uuid,name text not null check(length(name) between 1 and 100),dose text not null default '' check(length(dose)<=100),
 frequency text not null default '' check(length(frequency)<=100),status text not null default 'Needs review' check(status in ('Confirmed','Needs review')),
 foreign key(patient_id,doctor_id) references public.fh_doctors(patient_id,id),unique(patient_id,id)
);
create table public.fh_appointments (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.fh_patients(id),
 doctor_id uuid,reason text not null check(length(reason) between 1 and 500),starts_at timestamptz not null,
 duration_minutes integer not null default 30 check(duration_minutes between 1 and 1440),
 foreign key(patient_id,doctor_id) references public.fh_doctors(patient_id,id),unique(patient_id,id)
);
create table public.fh_medical_history (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.fh_patients(id),
 doctor_id uuid,occurred_on date not null,summary text not null check(length(summary) between 1 and 2000),
 foreign key(patient_id,doctor_id) references public.fh_doctors(patient_id,id)
);
create table public.fh_appointment_questions (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.fh_patients(id),
 appointment_id uuid not null,author_id uuid not null default auth.uid() references auth.users(id),
 question text not null check(length(btrim(question)) between 1 and 500),
 selected_for_checklist boolean not null default false,sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 foreign key(patient_id,appointment_id) references public.fh_appointments(patient_id,id)
);
create index fh_questions_appointment on public.fh_appointment_questions(patient_id,appointment_id);

-- Owner-executed helpers do not re-enter membership RLS. They never accept a caller-supplied user identity.
create function fh_private.role_for(p_patient uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.fh_memberships where patient_id=p_patient and user_id=auth.uid()
$$;
create function fh_private.intended_recipient(p_email text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null and lower(email)=p_email)
$$;
create function fh_private.upcoming(p_patient uuid,p_appointment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select fh_private.role_for(p_patient) is not null and exists(select 1 from public.fh_appointments where patient_id=p_patient and id=p_appointment and starts_at>now())
$$;
create function fh_private.log_event(p_patient uuid,p_event text,p_object uuid default null,p_subject uuid default null) returns void language sql security definer set search_path='' as $$
 insert into public.fh_audit_events(patient_id,actor_id,event,object_id,subject_user_id) values(p_patient,auth.uid(),p_event,p_object,p_subject)
$$;
create function fh_private.lock_admin(p_patient uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
  perform 1 from public.fh_patients where id=p_patient for update;
  if not found or not exists(select 1 from public.fh_memberships where patient_id=p_patient and user_id=auth.uid() and role='administrator') then
   raise exception 'Administrator access required' using errcode='42501';
  end if;
 end
$$;

-- Every new table is private by default. No legacy policies/grants are replaced.
do $$ declare t text; begin
 foreach t in array array['fh_patients','fh_memberships','fh_invitations','fh_admin_removal_requests','fh_admin_removal_approvals','fh_audit_events','fh_doctors','fh_medications','fh_appointments','fh_medical_history','fh_appointment_questions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy fh_patient_read on public.fh_patients for select to authenticated using(fh_private.role_for(id) is not null);
grant update(name) on public.fh_patients to authenticated;
create policy fh_patient_edit on public.fh_patients for update to authenticated using(fh_private.role_for(id)='administrator') with check(fh_private.role_for(id)='administrator');
create policy fh_members_read on public.fh_memberships for select to authenticated using(fh_private.role_for(patient_id) is not null);
create policy fh_invitation_read on public.fh_invitations for select to authenticated using(fh_private.role_for(patient_id)='administrator' or (cancelled_at is null and accepted_at is null and expires_at>now() and fh_private.intended_recipient(recipient_email)));
create policy fh_request_read on public.fh_admin_removal_requests for select to authenticated using(fh_private.role_for(patient_id)='administrator');
create policy fh_approval_read on public.fh_admin_removal_approvals for select to authenticated using(exists(select 1 from public.fh_admin_removal_requests r where r.id=request_id and fh_private.role_for(r.patient_id)='administrator'));
create policy fh_audit_read on public.fh_audit_events for select to authenticated using(fh_private.role_for(patient_id)='administrator');

do $$ declare t text; begin
 foreach t in array array['fh_doctors','fh_medications','fh_appointments','fh_medical_history'] loop
  execute format('grant insert, delete on public.%I to authenticated',t);
  execute format('create policy fh_read on public.%I for select to authenticated using(fh_private.role_for(patient_id) is not null)',t);
  execute format('create policy fh_insert on public.%I for insert to authenticated with check(fh_private.role_for(patient_id)=''administrator'')',t);
  execute format('create policy fh_edit on public.%I for update to authenticated using(fh_private.role_for(patient_id)=''administrator'') with check(fh_private.role_for(patient_id)=''administrator'')',t);
  execute format('create policy fh_delete on public.%I for delete to authenticated using(fh_private.role_for(patient_id)=''administrator'')',t);
 end loop;
end $$;
grant update(name,specialty) on public.fh_doctors to authenticated;
grant update(doctor_id,name,dose,frequency,status) on public.fh_medications to authenticated;
grant update(doctor_id,reason,starts_at,duration_minutes) on public.fh_appointments to authenticated;
grant update(doctor_id,occurred_on,summary) on public.fh_medical_history to authenticated;
create policy fh_question_read on public.fh_appointment_questions for select to authenticated using(fh_private.role_for(patient_id) is not null);
grant insert(patient_id,appointment_id,question) on public.fh_appointment_questions to authenticated;
grant update(selected_for_checklist) on public.fh_appointment_questions to authenticated;
grant delete on public.fh_appointment_questions to authenticated;
create policy fh_question_add on public.fh_appointment_questions for insert to authenticated with check(fh_private.role_for(patient_id) is not null and author_id=auth.uid() and fh_private.upcoming(patient_id,appointment_id));
create policy fh_question_select on public.fh_appointment_questions for update to authenticated using(fh_private.role_for(patient_id) is not null and fh_private.upcoming(patient_id,appointment_id)) with check(fh_private.role_for(patient_id) is not null and fh_private.upcoming(patient_id,appointment_id));
create policy fh_question_remove on public.fh_appointment_questions for delete to authenticated using(fh_private.role_for(patient_id)='administrator');

create function public.fh_create_demo_patient() returns uuid language plpgsql security definer set search_path='' as $$
 declare pid uuid; begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
  insert into public.fh_patients(name,created_by) values('Fictional family demo',auth.uid()) returning id into pid;
  insert into public.fh_memberships(patient_id,user_id,role) values(pid,auth.uid(),'administrator');
  perform fh_private.log_event(pid,'patient_created',pid,auth.uid());return pid;
 end
$$;
create function public.fh_invite(p_patient uuid,p_email text,p_role text,p_expires_at timestamptz default now()+interval '7 days') returns uuid language plpgsql security definer set search_path='' as $$
 declare iid uuid; recipient text:=lower(btrim(p_email));begin
  perform fh_private.lock_admin(p_patient);
  if p_role is null or p_role not in ('administrator','family_member') or recipient is null or recipient not like '%@%' or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '7 days' then raise exception 'Invalid invitation';end if;
  if exists(select 1 from public.fh_memberships m join auth.users u on u.id=m.user_id where m.patient_id=p_patient and lower(u.email)=recipient) then raise exception 'User already has access; use role management';end if;
  insert into public.fh_invitations(patient_id,recipient_email,role,invited_by,expires_at) values(p_patient,recipient,p_role,auth.uid(),p_expires_at) returning id into iid;
  perform fh_private.log_event(p_patient,'invitation_created',iid);return iid;
 end
$$;
create function public.fh_accept_invitation(p_invitation uuid) returns uuid language plpgsql security definer set search_path='' as $$
 declare i public.fh_invitations;begin
  select * into i from public.fh_invitations where id=p_invitation;
  if not found or not fh_private.intended_recipient(i.recipient_email) then raise exception 'Invitation unavailable' using errcode='42501';end if;
  perform 1 from public.fh_patients where id=i.patient_id for update;
  select * into i from public.fh_invitations where id=p_invitation for update;
  if i.accepted_at is not null or i.cancelled_at is not null or i.expires_at<=now() or not exists(select 1 from public.fh_memberships where patient_id=i.patient_id and user_id=i.invited_by and role='administrator') then raise exception 'Invitation unavailable' using errcode='42501';end if;
  -- Never upsert roles: invitations cannot elevate an existing membership.
  insert into public.fh_memberships(patient_id,user_id,role) values(i.patient_id,auth.uid(),i.role);
  update public.fh_invitations set accepted_by=auth.uid(),accepted_at=now() where id=i.id;
  perform fh_private.log_event(i.patient_id,'invitation_accepted',i.id,auth.uid());return i.patient_id;
 end
$$;
create function public.fh_cancel_invitation(p_invitation uuid) returns void language plpgsql security definer set search_path='' as $$
 declare pid uuid;begin
  select patient_id into pid from public.fh_invitations where id=p_invitation;
  perform fh_private.lock_admin(pid);
  update public.fh_invitations set cancelled_at=now() where id=p_invitation and accepted_at is null and cancelled_at is null;
  if not found then raise exception 'Invitation unavailable';end if;
  perform fh_private.log_event(pid,'invitation_cancelled',p_invitation);
 end
$$;
create function public.fh_revoke_member(p_patient uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
  perform fh_private.lock_admin(p_patient);
  delete from public.fh_memberships where patient_id=p_patient and user_id=p_user and role='family_member';
  if not found then raise exception 'Family member required; administrator changes need approval' using errcode='42501';end if;
  update public.fh_invitations set cancelled_at=now() where patient_id=p_patient and accepted_at is null and cancelled_at is null and recipient_email=(select lower(email) from auth.users where id=p_user);
  perform fh_private.log_event(p_patient,'member_revoked',null,p_user);
 end
$$;
create function public.fh_promote_member(p_patient uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
  perform fh_private.lock_admin(p_patient);
  update public.fh_memberships set role='administrator' where patient_id=p_patient and user_id=p_user and role='family_member';
  if not found then raise exception 'Family member required';end if;
  perform fh_private.log_event(p_patient,'member_promoted',null,p_user);
 end
$$;
create function public.fh_request_admin_removal(p_patient uuid,p_user uuid,p_action text) returns uuid language plpgsql security definer set search_path='' as $$
 declare rid uuid;begin
  perform fh_private.lock_admin(p_patient);
  if p_user=auth.uid() or p_user is null or p_action is null or p_action not in ('revoke','demote') or not exists(select 1 from public.fh_memberships where patient_id=p_patient and user_id=p_user and role='administrator') then raise exception 'Another current administrator is required' using errcode='42501';end if;
  if (select count(*) from public.fh_memberships where patient_id=p_patient and role='administrator')<=1 then raise exception 'Last administrator protected' using errcode='42501';end if;
  update public.fh_admin_removal_requests set status='cancelled' where patient_id=p_patient and target_user_id=p_user and status='pending' and expires_at<=now();
  insert into public.fh_admin_removal_requests(patient_id,requested_by,target_user_id,action) values(p_patient,auth.uid(),p_user,p_action) returning id into rid;
  perform fh_private.log_event(p_patient,'admin_removal_requested',rid,p_user);return rid;
 end
$$;
create function public.fh_approve_admin_removal(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
 declare r public.fh_admin_removal_requests;begin
  select * into r from public.fh_admin_removal_requests where id=p_request;
  if not found or r.target_user_id<>auth.uid() or auth.uid() is null then raise exception 'Target administrator approval required' using errcode='42501';end if;
  perform fh_private.lock_admin(r.patient_id);
  select * into r from public.fh_admin_removal_requests where id=p_request for update;
  if r.status<>'pending' or r.expires_at<=now() or r.requested_by=r.target_user_id or not exists(select 1 from public.fh_memberships where patient_id=r.patient_id and user_id=r.requested_by and role='administrator') then raise exception 'Request unavailable' using errcode='42501';end if;
  if (select count(*) from public.fh_memberships where patient_id=r.patient_id and role='administrator')<=1 then raise exception 'Last administrator protected' using errcode='42501';end if;
  insert into public.fh_admin_removal_approvals(request_id,approved_by) values(r.id,auth.uid());
  perform fh_private.log_event(r.patient_id,'admin_removal_approved',r.id,r.target_user_id);
  if r.action='revoke' then
   delete from public.fh_memberships where patient_id=r.patient_id and user_id=r.target_user_id;
   update public.fh_invitations set cancelled_at=now() where patient_id=r.patient_id and accepted_at is null and cancelled_at is null and recipient_email=(select lower(email) from auth.users where id=r.target_user_id);
  else update public.fh_memberships set role='family_member' where patient_id=r.patient_id and user_id=r.target_user_id;end if;
  update public.fh_admin_removal_requests set status='completed',completed_at=now() where id=r.id;
  perform fh_private.log_event(r.patient_id,'admin_removal_completed',r.id,r.target_user_id);
 end
$$;
create function public.fh_cancel_admin_removal(p_request uuid) returns void language plpgsql security definer set search_path='' as $$
 declare pid uuid;begin
  select patient_id into pid from public.fh_admin_removal_requests where id=p_request;
  perform fh_private.lock_admin(pid);
  update public.fh_admin_removal_requests set status='cancelled' where id=p_request and status='pending';
  if not found then raise exception 'Request unavailable';end if;
  perform fh_private.log_event(pid,'admin_removal_cancelled',p_request);
 end
$$;
create function public.fh_order_question(p_question uuid,p_order integer) returns void language plpgsql security definer set search_path='' as $$
 declare pid uuid;begin
  select patient_id into pid from public.fh_appointment_questions where id=p_question;
  perform fh_private.lock_admin(pid);
  if p_order is null or p_order<0 or p_order>10000 then raise exception 'Invalid order';end if;
  update public.fh_appointment_questions set sort_order=p_order where id=p_question;
  perform fh_private.log_event(pid,'question_ordered',p_question);
 end
$$;

-- Audit content-free record events, including question adds and selections.
create function fh_private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
 declare pid uuid;oid uuid;begin
  if tg_op='DELETE' then pid:=old.patient_id;oid:=old.id;else pid:=new.patient_id;oid:=new.id;end if;
  perform fh_private.log_event(pid,tg_table_name||':'||lower(tg_op),oid);
  if tg_op='DELETE' then return old;else return new;end if;
 end
$$;
do $$ declare t text;begin
 foreach t in array array['fh_doctors','fh_medications','fh_appointments','fh_medical_history','fh_appointment_questions'] loop
  execute format('create trigger fh_audit after insert or update or delete on public.%I for each row execute function fh_private.audit_record()',t);
 end loop;
end $$;

create function fh_private.audit_patient() returns trigger language plpgsql security definer set search_path='' as $$
 begin perform fh_private.log_event(new.id,'patient_updated',new.id);return new;end
$$;
create trigger fh_audit_patient after update on public.fh_patients for each row execute function fh_private.audit_patient();

-- PostgreSQL's default PUBLIC EXECUTE must not expose definer internals.
revoke all on all functions in schema fh_private from public,anon,authenticated;
grant execute on function fh_private.role_for(uuid),fh_private.intended_recipient(text),fh_private.upcoming(uuid,uuid) to authenticated;
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fh\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
