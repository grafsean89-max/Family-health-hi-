"""Real concurrent PostgreSQL connections; test database/container only."""
import subprocess, sys, concurrent.futures, threading
container = sys.argv[1]
def sql(text, check=True):
    result = subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-At'],input=text,text=True,capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result
sql("""
insert into public.fh_patients(id,name,created_by) values('10000000-0000-0000-0000-000000000001','Fictional concurrency demo','00000000-0000-0000-0000-000000000001');
insert into public.fh_memberships(patient_id,user_id,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','administrator'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','administrator');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into test.ids values('race_remove_b',public.fh_request_admin_removal('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','revoke'));
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into test.ids values('race_remove_a',public.fh_request_admin_removal('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','revoke'));
""")
barrier=threading.Barrier(2)
def approve(user,request):
    barrier.wait()
    return sql(f"""begin;set role authenticated;set request.jwt.claim.sub='{user}';
select public.fh_approve_admin_removal((select id from test.ids where name='{request}'));
select pg_sleep(0.4);commit;""",check=False)
with concurrent.futures.ThreadPoolExecutor(2) as pool:
    jobs=[pool.submit(approve,'00000000-0000-0000-0000-000000000001','race_remove_a'),pool.submit(approve,'00000000-0000-0000-0000-000000000002','race_remove_b')]
    results=[job.result() for job in jobs]
assert sum(result.returncode==0 for result in results)==1,[(r.returncode,r.stderr) for r in results]
remaining=sql("select count(*) from public.fh_memberships where patient_id='10000000-0000-0000-0000-000000000001' and role='administrator'").stdout.strip()
assert remaining=='1',remaining
approvals=sql("select count(*) from public.fh_admin_removal_approvals a join public.fh_admin_removal_requests r on r.id=a.request_id where r.patient_id='10000000-0000-0000-0000-000000000001'").stdout.strip()
assert approvals=='1',approvals
print('PASS: simultaneous reciprocal approvals serialize; only one succeeds and the last administrator remains')
