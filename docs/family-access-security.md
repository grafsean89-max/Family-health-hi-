# Family access Phase 1 — fictional data only

This phase is for fictional development records. The existing public HTML still contains the fictional demo arrays. Authentication does not make those embedded arrays private. This app is not claimed to be HIPAA compliant or suitable for real patient records. No real medical data should be entered, imported, or used in testing.

## Architecture and roles

`FAMILY_ACCESS_ENABLED=true` in Vercel enables patient mode through `/api/config`. The flag selects the UI/data source; it is **not an authorization boundary**. PostgreSQL policies apply even to callers that bypass the UI. The default remains the existing demo and legacy question path until a reviewed cutover. No legacy table, RLS policy, or production secret is changed by this PR.

All new application tables use the `public.fh_` prefix. Supabase's existing authenticated user session supplies the identity through `auth.uid()`. The browser uses only the existing publishable key and SDK; no service-role credentials or client role claims are used. Do not expose `fh_private` through PostgREST's exposed schemas. Public RPCs have fixed empty search paths, qualified table references and explicit execute grants. RLS helper functions are owned by the migration owner and read memberships without re-entering membership policies. Their only user identity is `auth.uid()`.

Each patient has independent memberships. One user can have different roles on different patients. Administrators manage patient names and doctors, medications, appointments and medical history, manage invitations, promote members, revoke family memberships, request administrator removals/demotions, and organize questions. Family members can read only their authorized patients, add questions before appointments, and select/unselect shared questions for checklists. They cannot change medical records, invitations, membership roles, question authors/content or question order. Both roles see questions from other authorized members. Medical relationships and question appointments use composite patient/record foreign keys, preventing links across patients.

Patient creation is an authenticated-only RPC that creates an **empty fictional demo patient**, atomically installs its first administrator, and logs creation. The UI can then rename the fictional patient. There is no public patient list, anonymous patient access, automatic invitation acceptance, or default membership for other users. Multiple administrators are supported through administrator-role invitations or explicit member promotion.

Direct browser insert/update/delete on membership, invitation, request, approval, and audit tables is denied by SQL privileges (not just policies). The only question update column granted is `selected_for_checklist`; inserting `author_id`, reassigning the patient, or changing an author is denied. Added questions take the authenticated author from a database default. An administrator-only RPC changes question order. Request and approval records cannot be forged directly.

## Administrator removal transaction

1. A current administrator requests removal or demotion of a **different current administrator**. A seven-day request is recorded and audited. Access stays unchanged.
2. The target signs in with their own Supabase account and explicitly approves their own request. The requester cannot approve on their behalf.
3. The RPC locks the patient row, re-reads the request, verifies its pending/unexpired status, verifies both distinct accounts are still administrators, and checks that at least one administrator will remain.
4. Approval, membership change, request completion, and their audit events commit together. Failure rolls the entire operation back. Replays fail.

All membership-changing RPCs use the same patient-row lock. Concurrent reciprocal approvals cannot remove both administrators. Auth-user foreign keys do not cascade membership removal, so deleting an Auth account cannot silently remove the last administrator. Trusted database owners can always bypass database controls; they are not app roles and must remain restricted operational identities.

Any administrator may cancel a pending request. Expired requests cannot be approved; a later request cancels the expired pending row. Medical record writes and patient-name changes are logged by owner-executed triggers. Audit entries include IDs, action and time, **not** question text, medical content, emails, passwords or invitation tokens. Administrators can read the patient audit trail but cannot mutate it through the app.

### Unavailable administrator recovery

There is no app override, self-approval, support RPC, or public break-glass credential. Prefer multiple administrators from the start. First recover the unavailable account through the project's approved Supabase Auth account recovery process, then use the ordinary approval workflow. Never impersonate the target to approve a removal.

If account recovery is impossible, keep existing access unchanged and escalate to the organization that controls the Supabase project. Before any privileged maintenance, require documented identity/authority verification, two independent authorized human reviewers, a backup, a least-privilege maintenance identity, and an external incident/audit record. Any future recovery transaction needs a separately reviewed design that preserves at least one administrator and records its justification. **This PR deliberately does not implement such an override.** Inability to obtain target approval can therefore leave a request unresolved.

## Invitations and revocation

Invitations are patient- and role-specific, expire within seven days, and are visible only to that patient's administrators and the intended verified recipient while pending. The recipient accepts from their in-app inbox. The database compares the current Auth user's confirmed canonical email with the stored normalized email; it does not trust a browser-supplied email or JWT role. The recipient must control that verified account. There are no transferable invitation bearer tokens. The UUID is a record identifier, not an authorization credential.

Acceptance locks the patient and invitation, rechecks expiry/cancellation/acceptance and that the inviter is still an administrator, then inserts the membership. It never upserts an existing member's role. A cancelled, expired, replayed, or wrong-recipient invitation fails. Revocation also cancels pending invitations for the revoked account, preventing old pending grants from restoring access.

No outbound invitation email is sent in this phase. The inviter must tell the intended recipient to sign in with the invited verified email and open the inbox; do not send identifiers or sensitive patient details in logs. Self-service signup, SMTP notification delivery, and production account provisioning are existing Supabase/operator concerns and are not changed here.

Memberships are looked up on every new database statement, so revocation takes effect for subsequent reads and writes immediately after commit, even with a still-valid access token. An already-running query uses PostgreSQL's statement snapshot; revocation cannot recall bytes previously returned to a device. The UI rechecks membership before writes, rechecks it after record loads, polls every three seconds while visible, and rechecks on focus. It clears data on revocation, access-check failure, backgrounding, offline detection or sign-out. A role downgrade removes administrator controls even during a draft. Responses from prior account/patient epochs are discarded. Patient records are not written to localStorage; only Supabase's supported session persistence remains.

Remote revocation can take up to the poll interval **plus request latency** to clear displayed data. It is not an instantaneous remote-wipe guarantee. Browsers can throttle timers and cannot retract screenshots, clipboard contents, calendar exports or already copied data. Database authorization remains the security boundary. Realtime authorization/presence and stronger display guarantees are not implemented in this phase.

## Deployment plan — requires human approval

1. Review this PR and run `bash supabase/tests/run.sh` in an isolated Docker environment. Review the migration for your actual PostgreSQL/Supabase version and Auth schema. The test fixture simulates authenticated JWT identity while exercising **actual PostgreSQL RLS, grants, functions, constraints and concurrent transactions**; it is not a full Supabase stack.
2. Back up the target **staging** database and inspect existing `appointment_questions` columns, policies, grants and ownership. The repository did not previously contain its DDL; do not assume it has any particular ownership column or relax its policies to make migration work.
3. Apply `supabase/migrations/202610110001_family_access.sql` to an approved staging project as the migration owner, using Supabase migrations or its SQL editor. It is transactional and additive, not an idempotent setup script. Do not apply `supabase/tests/bootstrap.sql` to Supabase; it is for a disposable local database only. Keep `fh_private` out of exposed schemas. No production migration is applied by CI or this PR.
4. Provision fictional administrator/member test accounts through the existing Auth setup with verified emails. Test live administrator and member permissions, wrong-patient access, invitations, questions, token restoration, and revocation using real signed-in accounts. Confirm failed authenticated writes in addition to UI behavior. Check project API logs are configured not to record sensitive request bodies.
5. Create empty fictional patients and fictional medical records. For old fictional questions, follow the explicit import procedure below; do not migrate real data or infer authorship from `added_by` labels.
6. In a reviewed Vercel development/preview environment, keep existing Supabase URL/publishable-key bindings and set `FAMILY_ACCESS_ENABLED=true`. Bind this preview to staging, never to a production project by accident. Deploy the branch only through your approved deployment workflow. This task does not deploy it.
7. Before any broader cutover, retire or restrict legacy table access in a **separately reviewed migration** based on its actual schema/policies and backup. Do not simply combine new family memberships with permissive legacy policies. The legacy path must never be a backdoor to protected patient data. This PR leaves its existing policies untouched so demo mode continues to work.
8. A production cutover is outside this unapproved task. Do not merge, deploy migrations, replace Auth policies, or edit production secrets without approval. Even after this feature is deployed, use only fictional records until a separate privacy/security assessment authorizes more.

### Safe legacy question import

The legacy table uses string appointment IDs (`a1`, etc.) and arbitrary author labels. Its ownership DDL is not version-controlled here. Blindly assigning all rows to the first new patient is unsafe.

- Work from a backed-up, reviewed **fictional-only** source in staging. Verify ownership using the actual old RLS/owner field and account history. If original Auth authors cannot be verified, leave the rows in the isolated legacy demo; do not guess identities from display labels.
- Create the destination fictional patient, memberships, doctors and appointments explicitly. Record a reviewed mapping for every active legacy question: source question ID, source appointment ID, destination patient/appointment UUID, verified original Auth author UUID, new question UUID, and affirmative fictional-data confirmation.
- In the same privileged staging session, create the temporary `fh_legacy_map` table described in `supabase/legacy/import-fictional-questions.sql`, populate the reviewed mappings, then run that **optional operator script**. It locks the source against concurrent writes and imports atomically, preserving question content, author identity, timestamp and checklist selection. It validates patient/appointment relationships and current author membership, refuses missing/removed source rows, incomplete mappings and duplicate target IDs. It never rewrites source rows or policies. The source must have the columns used by the script; stop and adapt through review if inspection finds otherwise.
- Compare counts, content, selected state and relationships; retain the source backup and mapping securely. Test sharing under real administrator/member accounts. Coordinate a write freeze until cutover to avoid new unimported questions. Soft-removed old questions remain in the archived source rather than being resurrected.
- Retire legacy API access only after its actual policies and all consumers are reviewed. Do not use a permissive policy or a browser service-role key as a workaround.

### Rollback

Before applying the additive migration, record backups and the prior Vercel release/environment bindings. If the migration itself fails, its transaction rolls back; investigate without changing legacy policies. If preview validation fails, keep the new tables but disable/withdraw the preview and retain backups/audit data. Default demo mode can remain in the original isolated fictional environment; it is not a fallback data source for patient-specific records.

After patient-mode cutover, place the app in a static maintenance state and stop affected ingress/writes before reverting a Vercel release. Do **not** simply flip the flag back to legacy mode for new family users: that is a different authorization model. Preserve all new tables, memberships, approvals, audit events and export/backups. Repair with a separately reviewed forward migration or restore a validated staging backup. No automatic down migration drops clinical/access/audit tables. A future production rollback must be reviewed with the database owner and verify legacy isolation before enabling any older client.

## Tests and remaining limits

- `bash supabase/tests/run.sh`: starts a network-isolated PostgreSQL 16 container, uses disposable Auth fixtures, applies the actual migration, checks RLS/role/patient/invitation/question permissions and runs independent concurrent approvals. No production credentials or ports are used. Requires Docker and Python 3. The official image is checksum-verified by Docker; the image digest used in this task is recorded in the PR.
- Start `python3 -m http.server 3000 --bind 127.0.0.1` at the repository root, then run `node supabase/tests/browser-family.cjs`, `node tests/browser.cjs`, and `node tests/session.cjs`. Requires Playwright and Chromium; `TEST_BASE_URL` and `CHROMIUM_PATH` can override defaults. Browser fixtures are fictional HTTP mocks; PostgreSQL tests independently enforce real database rules.
- No existing Supabase project/account or production DDL was available. Live Supabase/PostgREST/JWT verification, Vercel integration, email verification/provider behavior, physical iOS browsers, and the import against the actual legacy schema remain unverified. The optional import is tested locally with a representative fictional legacy fixture, not production data.
- Automated email delivery, realtime remote-wipe behavior, rate limiting/abuse controls for patient creation and invitations, member-friendly profile names, durable external audit retention and privileged administrator recovery are not implemented. Expired invitations/requests remain stored for audit; no cleanup scheduler is installed.
- These controls are a foundation for fictional patient-specific development, not a medical privacy compliance claim. No secrets or real patient data are committed.
