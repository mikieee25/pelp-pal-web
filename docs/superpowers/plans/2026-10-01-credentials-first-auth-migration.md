# Credentials-First Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove user-facing device enrollment from PELP Pal web and Flutter while moving online authentication and password changes to Supabase Auth with account-based authorization.

**Architecture:** Supabase Auth becomes the online identity provider. `organization_accounts.auth_user_id` maps Auth users to organization, username, role, active state, catalog scope, and credential version; `auth_alias` stores a server-generated non-delivery Auth email alias derived from the immutable account id. Users enter their username, and a protected function maps it to the alias before password sign-in. RLS and sync RPCs authorize through the account mapping instead of `devices`. Clients retain local Argon2id credentials for offline login and require a fresh online login when the account credential version changes.

**Tech Stack:** Supabase Auth, Postgres migrations/RLS/RPCs, Supabase Edge Functions, Supabase Storage, Flutter/Supabase Flutter, Next.js App Router, `@supabase/ssr`, `@supabase/supabase-js`, Dexie, `hash-wasm`, Vitest, Flutter tests, and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-credentials-first-auth-migration.md`

## Global Constraints

- Keep `devices` and enrollment rows during the compatibility window; do not delete historical references.
- Do not expose `service_role`, secret keys, password hashes, or reset command hashes through client-readable tables.
- Do not remove enrollment UI until account-based login and RLS pass the disposable multi-organization acceptance suite.
- Preserve offline local Argon2id verification and require `credential_version` equality for offline login.
- Keep all password failure messages generic and rate-limit online login/password-change endpoints.
- Do not change inspection conflict semantics or cursor idempotency during the auth migration.
- Every schema or Edge Function change must be verified against the deployed Supabase project and then represented in the Flutter repository migration history.

---

### Task 1: Freeze the current auth contract and migration fixtures

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\features\auth\credentials_auth_fixtures_test.dart`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\superpowers\specs\2026-10-01-credentials-first-auth-migration.md`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`
- Create: `tests/unit/auth/auth-contract.test.ts`

**Interfaces:**
- Fixture account: `{ id, organization_id, username, auth_alias, auth_user_id, role, is_active, credential_version }`.
- Fixture identities: active admin, active EPRED, active guest, inactive account, two organizations, and a revoked legacy device.

- [x] **Step 1: Add fixtures for the account identity and credential-version contract.**

```ts
export const accountIdentityFixture = {
  id: 'account-1',
  organization_id: 'org-1',
  username: 'inspector',
  auth_alias: 'account-account-1@auth.pelp-pal.test',
  auth_user_id: 'auth-user-1',
  role: 'epred',
  is_active: true,
  credential_version: 1,
};
```

- [x] **Step 2: Write tests that reject missing `auth_user_id`, inactive accounts, mismatched organization IDs, and stale credential versions.**
- [x] **Step 3: Run `npm test -- --run tests/unit/auth/auth-contract.test.ts` and the focused Flutter auth test.**
- [x] **Step 4: Record the current `devices`-based RPC signatures and the compatibility window in both backend contract documents.**
- [ ] **Step 5: Commit the contract fixtures with `test(auth): define credentials-first migration contract`.**

### Task 2: Add account identity and credential-version schema

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\20261001010000_add_account_auth_identity.sql`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\20260827000008_schema_organization_accounts.sql` only for documentation comments; do not rewrite applied history.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\tests\credentials_first_auth.sql`

**Interfaces:**
- `organization_accounts.auth_alias TEXT NOT NULL` after backfill; this is a server-generated internal Auth email alias, not a contact address.
- `organization_accounts.auth_user_id UUID UNIQUE REFERENCES auth.users(id)`.
- `organization_accounts.credential_version BIGINT NOT NULL DEFAULT 1`.
- `public.current_account()` returns `organization_id`, `account_id`, `username`, `role`, `is_active`, `catalog_scope`, and `credential_version` for `auth.uid()`.
- `public.bump_credential_version(p_account_id UUID)` returns the new version and is callable only by the authenticated account itself or an authorized admin path.

- [x] **Step 1: Add the failing SQL assertions for unique Auth mapping, inactive-account rejection, and current-account lookup.**

```sql
select has_column('public', 'organization_accounts', 'auth_user_id');
select has_column('public', 'organization_accounts', 'credential_version');
select function_returns('public', 'current_account', 'jsonb');
```

- [x] **Step 2: Add the migration with nullable identity fields, unique indexes, the account identity helper, and the version RPC.** The helper must use `SECURITY DEFINER`, `SET search_path = ''`, `auth.uid()`, and a generic null result for missing/inactive accounts; it must not read user-editable JWT metadata.
- [x] **Step 3: Backfill internal Auth aliases from immutable account ids through a controlled migration script.** Do not accept client-provided aliases; require disposable-project validation of the chosen alias domain before production provisioning. The deterministic backfill and `NOT NULL` transition were applied to the new disposable project; non-empty production-data preflight remains a later rollout gate.
- [x] **Step 4: Add SQL tests proving an account cannot read another organization, an inactive account is denied, and a stale credential version is reported.**
- [ ] **Step 5: Apply the migration to a disposable project, run the SQL tests, run Supabase security advisors, and commit the migration.**

Disposable-project migration, SQL assertions, and security/performance advisor checks are complete. The Auth email-format probe rejected `.invalid` and accepted the `.test` form; the source and disposable project were updated accordingly. The commit portion remains intentionally deferred until explicitly authorized.

### Task 3: Provision and migrate Supabase Auth identities

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\provision-account-auth\index.ts`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\account-login\index.ts`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\_shared\account-auth.ts`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\features\auth\account_auth_remote_test.dart`

**Interfaces:**
- `POST /functions/v1/provision-account-auth`: admin-only, accepts `{ account_id, temporary_password }`, derives the internal Auth alias server-side, creates or links the Auth user, sets `email_confirm: true`, and never returns a password or service credential.
- `POST /functions/v1/account-login`: accepts `{ username, password }`, maps the username to the internal Auth alias server-side, calls Supabase Auth password sign-in, and returns the normal Auth session or a generic `Invalid credentials` response.
- `POST /functions/v1/admin-reset-password`: active-admin-only, accepts `{ target_username, temporary_password }`, updates the target Auth password, increments `credential_version`, and returns no password or hash. The configured `maog` account is authorized through `role = 'admin'`, not a hardcoded username.
- `public.organization_accounts.auth_user_id` is the only account-to-Auth mapping used by policies.

- [ ] **Step 1: Write tests for generic invalid-login responses, inactive-account denial, duplicate alias rejection, and no password logging.**
- [ ] **Step 2: Implement the shared server helper using the secret/service client only inside the Edge Function runtime.** Validate the server-generated alias, password length, account status, and organization mapping before provisioning.
- [ ] **Step 3: Implement the admin provisioning function with an authenticated admin check based on `current_account()`, not `devices.assigned_role`.**
- [ ] **Step 4: Implement the login function using Supabase Auth password sign-in and return only the session payload required by the client.** Add rate-limit handling and identical failure messages for unknown, inactive, and wrong-password accounts.
- [ ] **Step 5: Provision one disposable account per role and organization, verify login, and run Edge Function tests without logging secrets.**
- [ ] **Step 6: Commit with `feat(auth): provision Supabase account identities`.**

### Task 4: Replace device-based RLS with account-based RLS and RPC authorization

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\20261001011000_account_based_authorization.sql`
- Modify through replacement migration: `pull_sync_changes`, `push_inspection_revisions`, `push_activity_events`, `resolve_inspection_conflict`, `consume_account_reset`, catalog manifest policies, organization account policies, inspection/activity/evidence policies.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\tests\account_based_authorization.sql`

**Interfaces:**
- Every protected function resolves actor context from `current_account()`.
- New writes use `auth.uid()` as the authenticated actor; legacy `device_id` fields are nullable compatibility metadata.
- `pull_sync_changes` returns the same four collections and cursor behavior as the current contract.
- A revoked legacy device row no longer blocks an otherwise active account session; an inactive account does block it.

- [ ] **Step 1: Add failing cross-organization and inactive-account SQL tests for every table and RPC.**
- [ ] **Step 2: Add account-based policies with explicit `TO authenticated`, organization predicates, role predicates, and `WITH CHECK` clauses for updates/inserts.**
- [ ] **Step 3: Replace `FROM public.devices WHERE id = auth.uid()` actor lookups in all sync RPCs with `current_account()` lookups.** Keep idempotency, conflict responses, and cursor ordering unchanged.
- [ ] **Step 4: Make legacy device foreign-key fields nullable for new writes without rewriting historical rows.** Add an account actor column where a policy or audit query needs to distinguish an old device actor from the Auth account.
- [ ] **Step 5: Verify same-organization admin/EPRED/guest access, cross-organization denial, inactive-account denial, Storage path isolation, Realtime authorization, and retry idempotency.**
- [ ] **Step 6: Run `supabase db advisors`, export generated types, and commit the authorization migration only after all tests pass.**

### Task 5: Remove anonymous auth and enrollment from Flutter

**Files:**
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\logic\online_sync_coordinator.dart`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\data\remote_sync_source.dart`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\core\routing\app_router.dart`
- Remove from active routing: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\ui\device_enrollment_screen.dart`
- Add: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\auth\logic\online_auth_coordinator.dart`

**Interfaces:**
- `OnlineAuthCoordinator.signIn(username, password)` returns `{ authUserId, accountId, username, role, organizationId, credentialVersion }`.
- `OnlineAuthCoordinator.changePassword(currentPassword, newPassword)` updates Supabase Auth and the local Argon2id verifier only after both operations succeed.
- `OnlineSyncCoordinator` starts sync from an authenticated Supabase session; it never calls `signInAnonymously()` or `enrollDevice()`.

- [ ] **Step 1: Add failing Flutter tests proving a signed-out phone cannot sync, a valid account can sync without an enrollment code, and an inactive account is locked.**
- [ ] **Step 2: Implement online username/password sign-in and persist the Auth session using the existing secure storage mechanism.**
- [ ] **Step 3: Make local offline login require a matching `credential_version`; stale local credentials must direct the user to online sign-in.**
- [ ] **Step 4: Remove the enrollment gate from routing and delete anonymous-session startup from the sync coordinator.** Keep legacy enrollment data readable for old installs but stop creating new enrollment codes/devices.
- [ ] **Step 5: Add online password change, local Argon2id rehash, credential-version refresh, session refresh, and logout-on-failure behavior.**
- [ ] **Step 6: Run focused Flutter auth/sync tests, then the existing functional merge gate.**

### Task 6: Migrate the web client to credentials login and password change

**Files:**
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Modify: `src/lib/supabase/browser.ts`
- Modify: `src/lib/auth/session-bootstrap.ts`
- Modify: `src/lib/auth/local-session.ts`
- Modify: `src/lib/db/database.ts` and `src/lib/db/records.ts`
- Modify: `src/app/login/page.tsx`
- Create: `src/app/account/change-password/page.tsx`
- Modify: `src/app/account/page.tsx`
- Remove from active UI: `src/app/enroll/page.tsx` and the enrollment CTA on `src/app/page.tsx`
- Create: `tests/unit/auth/online-auth.test.ts`
- Create: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Browser authentication uses `@supabase/ssr` cookie sessions for server-visible auth and the browser client for interactive calls.
- `signInWithCredentials(username, password): Promise<{ userId: string; account: AccountRecord }>`.
- `changePassword(currentPassword, newPassword): Promise<void>` calls `auth.updateUser({ password: newPassword, current_password: currentPassword })`, then updates the local verifier/version transactionally.
- Workspace routes require a valid Auth session and account status; unauthenticated users are sent to `/login`.

- [ ] **Step 1: Write failing tests for login success/failure, inactive-account rejection, session restoration, password-change validation, and stale credential-version blocking.**
- [ ] **Step 2: Add the SSR client/middleware using PKCE/cookie sessions, while preserving the existing browser client for IndexedDB-driven pages.**
- [ ] **Step 3: Replace the local-only login page with username/password online login plus explicit offline-mode messaging when no network session exists.**
- [ ] **Step 4: Add the change-password form with current-password verification, minimum-length validation, generic errors, no password logging, and local Argon2id update after server success.**
- [ ] **Step 5: Remove enrollment links and route access, but keep a migration message for browsers containing legacy enrollment state.**
- [ ] **Step 6: Add route guards for `/dashboard`, `/lookup`, `/activity`, `/summary`, `/sync`, `/account`, and `/inspect/*`; preserve public access only for `/`, `/login`, manifest, robots, and error routes.**
- [ ] **Step 7: Run unit, E2E, build, and a disposable Supabase login/password-change test.**

### Task 7: Add credential-version propagation and offline recovery

**Files:**
- Modify: `src/lib/db/database.ts`, `src/lib/db/repository.ts`, `src/lib/sync/coordinator.ts`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\data\sync_repository.dart`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\logic\online_sync_coordinator.dart`
- Create: `tests/unit/auth/credential-version.test.ts`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\features\auth\credential_version_test.dart`

**Interfaces:**
- `accounts.credentialVersion` is persisted locally.
- `LocalRepository.markCredentialVersion(accountId, version)` is transactional.
- `LocalRepository.canUseOfflineCredentials(accountId)` returns false when the local version is lower than the last synchronized version or the account is inactive.

- [ ] **Step 1: Add failing tests for version equality, stale-version lockout, inactive-account lockout, and retry after online sign-in.**
- [ ] **Step 2: Map `credential_version` through account pulls and update local account metadata transactionally.**
- [ ] **Step 3: Make sync/session bootstrap refresh account status before enabling offline work.**
- [ ] **Step 4: Preserve unsynced drafts/outbox while requiring reauthentication; do not clear operational data on credential mismatch.**
- [ ] **Step 5: Run web and Flutter focused tests plus reload/offline recovery tests.**

### Task 8: Cut over, verify, and remove enrollment operations

**Files:**
- Modify: `docs/backend-contract.md`
- Modify: `docs/superpowers/plans/2026-10-01-pelp-pal-web.md`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\credentials-first-auth-migration.md`
- Create: `tests/e2e/credentials-first-migration.spec.ts`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\integration\credentials_first_migration_test.dart`

**Interfaces:**
- Test organizations: admin, EPRED, guest, inactive, two organizations, one legacy enrolled device, and one fresh phone with no device row.
- Acceptance flow: online login → scoped account/catalog pull → offline login → password change → credential version pull → stale offline lock → online reauthentication → inspection sync.

- [ ] **Step 1: Provision disposable Auth identities and account mappings without touching production data.**
- [ ] **Step 2: Verify fresh web and Flutter clients sign in without enrollment codes or pre-created device rows.**
- [ ] **Step 3: Verify organization isolation, role restrictions, inactive-account denial, Storage isolation, Realtime recovery, conflict resolution, and duplicate retry behavior.**
- [ ] **Step 4: Verify password changes from web and Flutter, including local offline verifier refresh and stale-version lockout on the other client.**
- [ ] **Step 5: Run `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`, `npm run test:e2e`, and the focused Flutter/SQL gates.**
- [ ] **Step 6: Deploy account-based policies and functions, monitor Auth/RPC errors, then disable enrollment-code issuance. Keep the legacy enrollment RPC available for the rollback window.**
- [ ] **Step 7: Record the deployment-only checks and do not delete legacy device/enrollment tables until all supported Flutter versions have crossed the compatibility window.**
- [ ] **Step 8: Commit each independently verified task and push only after the corresponding acceptance gate passes.**

## Open migration input

Before Task 2 can backfill identities, the alias domain must be validated in a disposable Supabase project and the existing `maog` account must be identified/configured as an active `admin`. No user email collection is required. The production rollout still needs a controlled temporary-password handoff for each provisioned account because this model intentionally has no email/SMS recovery channel.
