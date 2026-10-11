-- OPTIONAL OPERATOR SCRIPT, NOT AN AUTOMATIC MIGRATION. STAGING/FICTIONAL DATA ONLY.
-- First inspect the existing schema/RLS and backup the source. In this same psql
-- session, create a TEMP table fh_legacy_map with these columns and reviewed rows:
-- legacy_id text PRIMARY KEY, legacy_appointment_id text NOT NULL,
-- patient_id uuid NOT NULL, appointment_id uuid NOT NULL, author_id uuid NOT NULL,
-- new_question_id uuid UNIQUE NOT NULL, confirmed_fictional boolean NOT NULL.
-- Do not infer author identity from added_by labels. Use the verified original
-- Supabase Auth owner and explicit mappings for every active source question.
begin;
-- Stop legacy writes during the reviewed import/cutover. No existing grants are changed.
lock table public.appointment_questions in share mode;
do $$ begin
 if to_regclass('pg_temp.fh_legacy_map') is null then raise exception 'Reviewed temporary mapping required';end if;
 if not exists(select 1 from pg_temp.fh_legacy_map) then raise exception 'Empty mapping';end if;
 if exists(select 1 from pg_temp.fh_legacy_map where confirmed_fictional is distinct from true) then raise exception 'Only verified fictional records may be imported';end if;
 if exists(select 1 from pg_temp.fh_legacy_map m left join public.appointment_questions q on q.id::text=m.legacy_id and q.appointment_id::text=m.legacy_appointment_id where q.id is null or coalesce(q.is_removed,false)) then raise exception 'Missing or removed source question';end if;
 if exists(select 1 from public.appointment_questions q where not coalesce(q.is_removed,false) and not exists(select 1 from pg_temp.fh_legacy_map m where m.legacy_id=q.id::text)) then raise exception 'Every active fictional source row must have an explicit mapping';end if;
 if exists(select 1 from pg_temp.fh_legacy_map m where not exists(select 1 from public.fh_appointments a where a.patient_id=m.patient_id and a.id=m.appointment_id) or not exists(select 1 from public.fh_memberships pm where pm.patient_id=m.patient_id and pm.user_id=m.author_id)) then raise exception 'Invalid target appointment or authenticated author membership';end if;
 if exists(select 1 from pg_temp.fh_legacy_map m join public.fh_appointment_questions q on q.id=m.new_question_id) then raise exception 'Already imported target ID; compare before rerunning';end if;
end $$;
insert into public.fh_appointment_questions(id,patient_id,appointment_id,author_id,question,selected_for_checklist,created_at)
 select m.new_question_id,m.patient_id,m.appointment_id,m.author_id,q.question,q.selected_for_checklist,q.created_at
 from public.appointment_questions q join pg_temp.fh_legacy_map m on m.legacy_id=q.id::text;
-- Check counts, text, selections, authors, and appointment mapping before committing.
do $$ begin
 if (select count(*) from public.fh_appointment_questions q join pg_temp.fh_legacy_map m on m.new_question_id=q.id)<>(select count(*) from pg_temp.fh_legacy_map) then raise exception 'Import count mismatch';end if;
end $$;
commit;
-- Source rows and source RLS remain unchanged. Retain the reviewed mapping securely.
