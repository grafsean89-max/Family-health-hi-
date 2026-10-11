-- LOCAL TEST DATABASE ONLY: minimal Supabase Auth identity fixture.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated,anon;
grant execute on function auth.uid() to authenticated,anon;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','admin@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000002','admin2@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000003','member@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000004','outsider@example.invalid',now()),
 ('00000000-0000-0000-0000-000000000005','unverified@example.invalid',null);
create schema test;
create table test.ids(name text primary key,id uuid);
grant usage on schema test to authenticated,anon;
grant select,insert,update on test.ids to authenticated;
create function test.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function test.denied(statement text,label text) returns void language plpgsql as $$begin
 begin execute statement;exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation or raise_exception then raise notice 'PASS denied: %',label;return;end;
 raise exception 'FAIL unexpected authorization: %',label;
end$$;
-- Representative pre-existing single-owner demo schema; migration must not alter it.
create table public.appointment_questions(id bigint primary key,owner_id uuid not null references auth.users(id),appointment_id text not null,question text not null,added_by text,selected_for_checklist boolean not null default false,is_removed boolean not null default false,created_at timestamptz not null default now());
alter table public.appointment_questions enable row level security;
grant select,insert,update,delete on public.appointment_questions to authenticated;
create policy legacy_owner on public.appointment_questions to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
insert into public.appointment_questions(id,owner_id,appointment_id,question,added_by,selected_for_checklist,is_removed) values
(1,'00000000-0000-0000-0000-000000000002','a1','Fictional legacy question one','Untrusted display label',true,false),
(2,'00000000-0000-0000-0000-000000000002','a1','Fictional legacy question two','Another label',false,false),
(3,'00000000-0000-0000-0000-000000000002','a1','Fictional removed question','Label',true,true);
