-- Privileged, explicit fictional-only import fixture.
create temp table fh_legacy_map(legacy_id text primary key,legacy_appointment_id text not null,patient_id uuid not null,appointment_id uuid not null,author_id uuid not null,new_question_id uuid unique not null,confirmed_fictional boolean not null);
insert into fh_legacy_map values
 ('1','a1',(select id from test.ids where name='patient'),(select id from test.ids where name='appointment'),'00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',true),
 ('2','a1',(select id from test.ids where name='patient'),(select id from test.ids where name='appointment'),'00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',true);
\i /repo/supabase/legacy/import-fictional-questions.sql
select test.ok((select count(*)=2 from public.fh_appointment_questions where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002')),'explicit fictional legacy mapping imported');
select test.ok((select q.question=old.question and q.selected_for_checklist=old.selected_for_checklist and q.created_at=old.created_at and q.author_id=old.owner_id from public.fh_appointment_questions q join fh_legacy_map m on m.new_question_id=q.id join public.appointment_questions old on old.id::text=m.legacy_id where old.id=1),'legacy import preserves text author timestamp and selected checklist');
select test.ok((select count(*)=3 from public.appointment_questions),'legacy source untouched, removed rows retained only in source');
select test.ok((select count(*)=1 from pg_policies where tablename='appointment_questions' and policyname='legacy_owner' and qual='(owner_id = auth.uid())'),'existing legacy RLS unchanged');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select test.ok((select count(*)=0 from public.appointment_questions),'legacy owner policy still blocks other accounts');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select test.ok((select count(*)=3 from public.appointment_questions),'legacy owner demo still works');
select test.ok((select selected_for_checklist from public.fh_appointment_questions where id='20000000-0000-0000-0000-000000000001'),'imported patient checklist accessible');
reset role;
