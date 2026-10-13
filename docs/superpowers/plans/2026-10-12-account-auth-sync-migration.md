# Account-authenticated Sync and Device-enrollment Retirement Implementation Plan
> Superseded: device enrollment codes were removed on 2026-10-12.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Replace device-enrollment-based synchronization with authenticated personnel-account synchronization, make PELP Pal Web the primary system, keep Flutter field capture temporarily supported, and prepare a data-preserving final removal of device infrastructure.

**Architecture:** Supabase Auth personnel accounts become the sole sync identity. The database first gains account ownership and account-based authorization while legacy device columns remain available for rollback; web and Flutter then move to the new contract; only after verification is a separate cleanup migration created to remove enrollment and device infrastructure. The web remains the reference management client and Flutter remains a temporary offline capture client.

**Tech Stack:** Next.js 16.3.8, React 19.3, TypeScript 5.9, Supabase JS 2.117, Supabase SQL migrations/RLS/RPCs, Dexie 4.4, Vitest 5, Playwright 1.63, Flutter/Dart 3.13, Supabase Flutter 2.17, sqflite SQLCipher.

**Spec:** \`docs/superpowers/specs/2026-10-12-account-auth-sync-migration-design.md\`

## Global Constraints

- PELP Pal Web is the primary management, reporting, catalog, conflict, and sync-diagnostics system.
- Flutter remains supported only for offline inspection capture during the transition and is planned for retirement later.
- A signed-in personnel account is required for upload/download; signed-out work remains local-only.
- \`organization_accounts.id\` is the stable ownership key; \`auth_user_id\` resolves the current Supabase Auth identity.
- Clients never provide trusted organization, username, role, or catalog-scope authorization values.
- Cursor-based pull, idempotent push, and cursor advancement semantics remain unchanged.
- Realtime remains a pull hint and never advances cursors directly.
- Existing inspection, evidence, conflict, and report data must not be deleted.
- Any unmapped historical row must stop migration cleanup with an explicit diagnostic.
- Do not apply the final destructive cleanup migration to a remote Supabase project in this work.
- Do not stage or modify unrelated existing changes in either repository.
- No new dependencies.

## Repository map and change boundaries

Web repository: \`C:\\Users\\mklgr\\Codes\\pelp-pal-web\`

- \`src/lib/supabase/browser.ts\`: use one authenticated account client; remove device client after migration.
- \`src/lib/sync/runtime.ts\`: account-session gate, local-only boundary, realtime/polling lifecycle.
- \`src/lib/sync/coordinator.ts\` and \`src/lib/supabase/remote-source.ts\`: account-authenticated RPC adapter and sync operations.
- \`src/lib/db/records.ts\`, \`src/lib/db/database.ts\`, \`src/lib/db/repository.ts\`: account-scoped local records and outbox.
- \`src/features/sync/*\`: sync state, diagnostics, and account/local-only UI.
- \`src/features/enrollment/*\`, \`src/app/enroll\`, \`src/components/device\`, account enrollment panels, and related tests: remove after replacement behavior is covered.
- \`src/features/auth/*\`, \`src/app/login\`, workspace gates, and shell: account state and route behavior.
- \`tests/unit\`, \`tests/integration\`, and \`tests/e2e\`: contract, migration-boundary, and regression coverage.

Backend/Flutter repository: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\`

- \`supabase/migrations\`: additive account-ownership migration, account-based RPC/RLS migration, and separate final cleanup migration.
- \`supabase/functions\`: remove enrollment functions only after replacement paths and compatibility checks are complete.
- \`lib/features/sync/data/remote_sync_source.dart\`: account-session sync adapter; no enrollment calls.
- \`lib/features/sync/logic/online_sync_coordinator.dart\`: remove enrollment orchestration and retain offline capture/sync.
- \`lib/features/sync/ui/enrollment_gate.dart\` and \`device_enrollment_screen.dart\`: remove after route replacement.
- \`test/features/sync/*\`: account-auth, retry, outbox, and no-enrollment regression tests.

## Task 1: Establish a clean baseline and complete the ownership inventory

**Files:**
- Create: \`docs/superpowers/plans/2026-10-12-account-auth-sync-migration.md\` (this plan)
- Inspect: \`src/lib\`, \`src/features\`, \`src/app\`, \`tests\`, \`supabase/migrations\`
- Inspect: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\lib\`, \`test\`, \`supabase\`

**Interfaces:**
- Produces an inventory of every device/enrollment field, function, policy, local-store record, and test that later tasks must update.

- [ ] **Step 1: Verify both repository worktrees before editing.**

Run:

\`\`\`powershell
git -C C:\\Users\\mklgr\\Codes\\pelp-pal-web status --short --branch
git -C C:\\Users\\mklgr\\Codes\\pelp_pal_v2 status --short --branch
\`\`\`

Record unrelated changes and leave them untouched.

- [ ] **Step 2: Generate the complete web inventory.**

Run:

\`\`\`powershell
rg -n --hidden -g '!node_modules' -g '!\\.git' "device|enroll|authUserId|ensureAnonymousSession|getSupabaseDeviceClient|Enrollment" C:\\Users\\mklgr\\Codes\\pelp-pal-web\\src C:\\Users\\mklgr\\Codes\\pelp-pal-web\\tests C:\\Users\\mklgr\\Codes\\pelp-pal-web\\supabase
\`\`\`

Group results into runtime, UI, local database, server adapter, and tests. Do not delete a reference until its replacement behavior is identified.

- [ ] **Step 3: Generate the Flutter/backend inventory.**

Run:

\`\`\`powershell
rg -n --hidden -g '!\\.git' "device_enrolled|device_installation_id|enrollDevice|EnrollmentGate|device_enrollment|devices|auth\\.uid|Supabase\\.instance\\.client|owner_device_id|device_id|uploaded_by_device_id|edited_by_device_id" C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\lib C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\test C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase
\`\`\`

- [ ] **Step 4: Record the server column inventory before designing SQL.**

Use the linked Supabase project only for read-only inspection. Enumerate all columns referencing \`public.devices\` and all enrollment functions/policies from the current migration history. The result must identify every account backfill source, including evidence rows that do not carry a username directly.

- [ ] **Step 5: Run the existing web sync checks as a baseline.**

Run:

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp-pal-web
npm run lint
npx tsc --noEmit
npx vitest run tests/unit/sync tests/integration/realtime-sync.test.ts
\`\`\`

Expected: record the current result without changing tests to hide failures.

## Task 2: Add account-scoped local storage without losing existing work

**Files:**
- Modify: \`src/lib/db/records.ts\`
- Modify: \`src/lib/db/database.ts\`
- Modify: \`src/lib/db/repository.ts\`
- Modify: \`src/lib/auth/local-session-store.ts\` only if account scope is needed for local session metadata
- Test: \`tests/unit/db/database-migrations.test.ts\`
- Test: \`tests/unit/db/repository.test.ts\`
- Test: \`tests/unit/auth/local-session-store.test.ts\` when changed

**Interfaces:**
- Produces \`AccountScope = { accountId: string; organizationId: string; key: string }\`.
- Produces repository methods that read/write sync-owned rows only for the active account scope.
- Existing local rows remain readable during migration and are assigned scope only after their owner is known.

- [ ] **Step 1: Write failing tests for account scope and outbox isolation.**

Add tests that create two account scopes and prove that:

\`\`\`ts
expect(await repository.listInspections(scopeA)).toEqual([inspectionA]);
expect(await repository.listInspections(scopeB)).toEqual([inspectionB]);
expect(await repository.getPendingOutbox(scopeA)).toEqual([outboxA]);
expect(await repository.getPendingOutbox(scopeB)).toEqual([outboxB]);
\`\`\`

Also add a migration test proving an existing unscoped local record is preserved and surfaced for reconciliation instead of deleted.

- [ ] **Step 2: Run the focused tests and verify they fail for the missing scope behavior.**

Run:

\`\`\`powershell
npx vitest run tests/unit/db/repository.test.ts tests/unit/db/database-migrations.test.ts
\`\`\`

- [ ] **Step 3: Add the scope type and Dexie schema migration.**

Use \`organizationId:accountId\` as the stable local scope key. Add the field to inspection, revision, activity, conflict, tombstone, evidence, and outbox records where the repository needs filtering. Increment the Dexie version using the existing migration pattern; copy existing rows unchanged and assign scope only when an account owner is already determinable.

- [ ] **Step 4: Make repository reads and writes scope-aware.**

Require an active \`AccountScope\` for remote-sync operations. Filter every list, count, outbox selection, retry, delete, and apply-pull operation by scope. Keep explicitly local draft editing available before login, but mark it as pending account association and prevent upload.

- [ ] **Step 5: Run the focused tests and verify account isolation.**

Run:

\`\`\`powershell
npx vitest run tests/unit/db/repository.test.ts tests/unit/db/database-migrations.test.ts
\`\`\`

- [ ] **Step 6: Commit the independently testable local-storage change.**

\`\`\`powershell
git add src/lib/db/records.ts src/lib/db/database.ts src/lib/db/repository.ts tests/unit/db/repository.test.ts tests/unit/db/database-migrations.test.ts
git commit -m "feat: scope local sync data to personnel accounts"
\`\`\`

## Task 3: Add the account-authenticated backend compatibility migration

**Files:**
- Create with \`supabase migration new\`: account ownership compatibility migration in \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase\\migrations\`
- Modify only the newly created migration during this task
- Test: SQL/RPC test location discovered in Task 1, or add a focused repository test if no SQL-test harness exists

**Interfaces:**
- Adds account ownership columns referencing \`public.organization_accounts(id)\`.
- Backfills ownership from current device, organization, and username data.
- Raises a descriptive exception with table and row IDs for every unmapped row.
- Does not drop device columns, tables, enrollment functions, or data.

- [ ] **Step 1: Create the migration using the installed Supabase CLI.**

Run from the backend repository:

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp_pal_v2
supabase migration new add_account_sync_ownership
\`\`\`

Do not invent a timestamp or apply the migration remotely.

- [ ] **Step 2: Write assertions for the backfill preconditions.**

The migration must check that every active device maps to one active \`organization_accounts\` row through organization and assigned username, and that every evidence row can resolve its uploader. Use \`RAISE EXCEPTION\` with the table name and unresolved ID before adding \`NOT NULL\` constraints or changing write behavior.

- [ ] **Step 3: Add nullable account ownership columns and indexes.**

Use \`ADD COLUMN IF NOT EXISTS\` with foreign keys to \`public.organization_accounts(id)\`. Add indexes for organization/account ownership paths used by RLS and sync pulls. Keep existing device columns intact for compatibility.

- [ ] **Step 4: Backfill every table in one transaction.**

Backfill inspection owners, revision editors, activity authors, evidence uploaders, conflicts, and tombstones from the existing authoritative fields. Preserve username/display fields. Do not use a guessed account, \`auth.uid()\` from the migration session, or a destructive delete.

- [ ] **Step 5: Add migration assertions and run a local dry validation.**

Run the repository's SQL test harness if present. Otherwise use Supabase CLI validation available in the backend repo and inspect the generated SQL for transaction safety, explicit errors, and no \`DROP\` statements.

- [ ] **Step 6: Commit the additive migration separately.**

\`\`\`powershell
$migration = Get-ChildItem supabase/migrations -Filter '*_add_account_sync_ownership.sql' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
git add -- $migration.FullName
git commit -m "feat: add account ownership to sync records"
\`\`\`

The generated filename must be used literally in the command; do not stage \`masterlist.py\` or \`supabase/functions/personnel-management/index.ts\`.

## Task 4: Move server authorization and sync RPCs to account identity

**Files:**
- Create with \`supabase migration new\`: account-based sync authorization migration
- Modify: newly created migration only
- Inspect/update source definitions for \`pull_sync_changes\`, push inspection/revision, push activity, push evidence, conflict resolution, deletion, catalog access, and storage policies
- Test: SQL/RPC test harness or focused integration tests in the backend repository

**Interfaces:**
- Existing cursor arguments and pull result shape remain unchanged.
- Existing push idempotency and conflict semantics remain unchanged.
- Authorization derives account context from \`organization_accounts.auth_user_id = auth.uid()\`.

- [ ] **Step 1: Write failing authorization cases.**

Cover active admin, EPRED, guest, inactive account, cross-organization account, and unauthenticated caller. Assert that a caller cannot override organization, username, or account ownership through RPC payload fields.

- [ ] **Step 2: Run the authorization tests to establish failure against device-based policies.**

Run the existing SQL/integration command discovered in Task 1. Capture the failing policy/RPC names before changing them.

- [ ] **Step 3: Add a narrowly scoped account-context helper if needed.**

Prefer the existing \`public.current_account()\` contract. If a helper is required for repeated policy expressions, make it stable/secure, restrict execution to authenticated callers, set an explicit \`search_path\`, and return no account for inactive or unmapped users. Do not use a new public \`SECURITY DEFINER\` function to bypass RLS.

- [ ] **Step 4: Replace device lookups in policies and RPCs.**

Use the account context and account ownership columns for inspection, revision, activity, evidence, conflict, tombstone, catalog, and storage authorization. Keep device columns readable only as compatibility metadata; do not use them as the caller identity for new writes.

- [ ] **Step 5: Re-run authorization, cursor, and repeated-update tests.**

Run the complete backend SQL/integration test command plus the web sync integration tests. Verify the pull RPC still advances no cursor itself and repeated updates are returned in cursor order.

- [ ] **Step 6: Commit the account authorization migration separately.**

\`\`\`powershell
$migration = Get-ChildItem supabase/migrations -Filter '*_account_sync_authorization.sql' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
git add -- $migration.FullName
git commit -m "feat: authorize sync through personnel accounts"
\`\`\`

## Task 5: Switch PELP Pal Web to account-authenticated sync

**Files:**
- Modify: \`src/lib/supabase/browser.ts\`
- Modify: \`src/lib/supabase/remote-source.ts\`
- Modify: \`src/lib/sync/runtime.ts\`
- Modify: \`src/lib/sync/coordinator.ts\` only where active account scope is passed
- Modify: \`src/lib/db/browser.ts\` and repository integration where needed
- Modify: \`src/features/sync/sync-status-store.ts\`
- Modify: \`src/features/sync/sync-view.tsx\`
- Modify: \`src/features/sync/sync-runtime-boundary.tsx\`
- Modify: \`src/features/auth/workspace-auth-gate.tsx\` and app shell route guards as needed
- Test: \`tests/unit/sync/runtime.test.ts\`
- Test: \`tests/unit/sync/remote-source.test.ts\`
- Test: \`tests/unit/sync/coordinator.test.ts\`
- Test: \`tests/unit/sync/sync-view.test.tsx\`
- Test: \`tests/unit/sync/sync-runtime-boundary.test.tsx\`

**Interfaces:**
- \`getSupabaseBrowserClient()\` is the only Supabase client used for account auth and sync.
- \`createSyncRuntime()\` requires an active personnel session and obtains \`AccountScope\` from the authenticated account context.
- Signed-out runtime creation returns a local-only state rather than silently creating an anonymous device session.

- [ ] **Step 1: Add failing runtime tests for the account boundary.**

Test that no anonymous session is created, the runtime does not start remote sync without an account, and a signed-in account gets a scope before coordinator creation.

\`\`\`ts
expect(mockSignInAnonymously).not.toHaveBeenCalled();
expect(result?.statusStore.snapshot().mode).toBe('local-only');
\`\`\`

- [ ] **Step 2: Add failing UI tests for local-only and account-authenticated states.**

Cover signed-out local work, signed-in Live/Polling/Reconnecting states, pending uploads, and account-switch warnings. Ensure the UI no longer mentions enrollment or re-enrollment.

- [ ] **Step 3: Remove the device Supabase client from the runtime path.**

Use \`getSupabaseBrowserClient()\` in \`src/lib/sync/runtime.ts\` and delete the anonymous-session dependency from sync. Keep account session refresh under the existing auth flow.

- [ ] **Step 4: Pass account scope through repository and coordinator operations.**

Prevent outbox rows from another account scope from being pushed. Keep cursor state scoped to the active account. Apply pull pages only to that scope.

- [ ] **Step 5: Update sync diagnostics and copy.**

Replace enrollment status with account/sync status. Show actionable messages for signed-out local-only work, expired sessions, authorization errors, retries, conflicts, and realtime recovery.

- [ ] **Step 6: Remove web enrollment user paths after replacement tests pass.**

Remove \`/enroll\`, device enrollment status, enrollment-code panels/client modules, and tests that only verify enrollment. Update navigation and route tests so authenticated account access is the gate.

- [ ] **Step 7: Run the web focused suite.**

\`\`\`powershell
npx vitest run tests/unit/sync tests/unit/auth tests/unit/account.test.tsx tests/unit/app-shell.test.tsx tests/unit/dashboard.test.tsx
npm run lint
npx tsc --noEmit
\`\`\`

- [ ] **Step 8: Commit the web account-auth sync migration.**

\`\`\`powershell
git add src/lib/supabase src/lib/sync src/lib/db src/features/sync src/features/auth src/components src/app tests/unit
git commit -m "feat: make web sync account-authenticated"
\`\`\`

## Task 6: Move Flutter to account-authenticated transition sync

**Files:**
- Modify: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\lib\\features\\sync\\data\\remote_sync_source.dart\`
- Modify: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\lib\\features\\sync\\logic\\online_sync_coordinator.dart\`
- Modify: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\lib\\features\\sync\\logic\\sync_providers.dart\`
- Remove/replace: \`lib/features/sync/ui/enrollment_gate.dart\`
- Remove/replace: \`lib/features/sync/ui/device_enrollment_screen.dart\`
- Modify: Flutter local sync schema/repository files identified in Task 1 for account scope
- Test: \`test/features/sync/remote_sync_source_test.dart\`
- Test: \`test/features/sync/online_sync_coordinator_test.dart\`
- Test: \`test/features/sync/sync_repository_test.dart\`
- Test: account/auth tests covering logout and account switch

**Interfaces:**
- Remote sync uses the already signed-in personnel Supabase session.
- \`OnlineSyncCoordinator._runSync()\` no longer calls a device-enrollment bootstrap.
- No Flutter sync path calls \`enrollDevice\`, \`enroll-device\`, or reads \`device_enrolled\` for authorization.

- [ ] **Step 1: Write failing tests proving account-session sync and no enrollment call.**

Mock the account login session and assert \`_runSync()\` performs pull/push using that session. Assert \`enrollDevice\` is not invoked during startup, resume, retry, or manual sync.

- [ ] **Step 2: Remove the misleading anonymous-session method.**

Rename it to an account-session check or remove it if the existing auth coordinator already guarantees a valid session. It must refresh an expired account session and throw a clear signed-out error otherwise; it must never call anonymous sign-in.

- [ ] **Step 3: Remove enrollment orchestration and secure enrollment state.**

Delete the enrollment-code path, installation ID authorization path, and \`device_enrolled\` gate. Preserve unrelated secure storage such as credentials, biometric state, and account reset data.

- [ ] **Step 4: Add account-scope filtering to Flutter local sync.**

Partition local outbox/cursor/inspection data by the authenticated account and organization. Preserve existing local rows during schema upgrade and block upload until their ownership is resolved.

- [ ] **Step 5: Replace the enrollment gate with account/offline state.**

Users who are signed out can access local capture. Sync UI must state that sign-in is required for upload/download and expose retry after authentication.

- [ ] **Step 6: Run focused Flutter tests and static checks.**

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp_pal_v2
flutter test test/features/sync test/features/auth
flutter analyze
\`\`\`

If Flutter tooling is unavailable, run the focused Dart tests that the environment supports and report the exact infrastructure blocker.

- [ ] **Step 7: Commit only Flutter transition files.**

\`\`\`powershell
git add lib/features/sync lib/features/auth test/features/sync test/features/auth
git commit -m "feat: remove device enrollment from mobile sync"
\`\`\`

Do not stage existing unrelated \`masterlist.py\` or personnel-management changes.

## Task 7: Add cross-client sync and migration verification

**Files:**
- Modify: \`tests/e2e/two-device-sync.spec.ts\` to use two account-authenticated contexts rather than enrollment codes
- Create/modify: web integration tests for account ownership and scope
- Create/modify: Flutter sync tests for two consecutive revisions and offline recovery
- Create: backend SQL assertions if the backend repository has no existing harness

**Interfaces:**
- Device A/B terminology in tests means separate account-authenticated clients, not enrolled devices.
- Both clients use the same inspection ID and account-authorized organization scope.

- [ ] **Step 1: Write a web two-context test with account credentials.**

Create two browser contexts with separate authenticated accounts in the same organization. Edit the same inspection twice from context A and assert context B reflects both revisions without a manual refresh. Gate live credentials behind \`E2E_SUPABASE=1\`; skip with a clear reason otherwise.

- [ ] **Step 2: Add account-scope and cross-organization negative tests.**

Assert that an account cannot pull, push, edit, or read evidence outside its authorized organization/role scope.

- [ ] **Step 3: Add migration verification queries.**

Verify all affected rows have non-null valid \`organization_accounts.id\` ownership, no orphan account references exist, and count totals match before and after the additive migration.

- [ ] **Step 4: Run all supported tests.**

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp-pal-web
npm run lint
npx tsc --noEmit
npx vitest run
npx playwright test
\`\`\`

Run Flutter checks from Task 6. Record live-E2E skips separately from failures.

- [ ] **Step 5: Commit the cross-client verification changes.**

\`\`\`powershell
git add tests
git commit -m "test: verify account-authenticated cross-client sync"
\`\`\`

## Task 8: Create, but do not apply, the final device cleanup migration

**Files:**
- Create with \`supabase migration new\`: final device enrollment cleanup migration in \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase\\migrations\`
- Modify: enrollment Edge Functions and deployment manifests only after the migration is reviewed
- Test: migration assertions and schema inspection output

**Interfaces:**
- Cleanup is permitted only after the account backfill and cross-client verification reports pass.
- The migration contains no data deletion for inspections, revisions, evidence, activities, conflicts, or reports.
- The migration removes only obsolete enrollment/device structures after all dependencies are removed.

- [ ] **Step 1: Verify cleanup preconditions with read-only queries.**

Check that every affected row has account ownership, every active client uses account-auth sync, no test or source file references enrollment as a required path, and local/remote count reports match.

- [ ] **Step 2: Create the cleanup migration using the CLI.**

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp_pal_v2
supabase migration new remove_device_enrollment_infrastructure
\`\`\`

- [ ] **Step 3: Write dependency-safe cleanup SQL.**

Drop obsolete policies/functions and device foreign keys in dependency order, then remove enrollment-code structures and \`public.devices\`. Use explicit checks and comments. Do not use \`CASCADE\` against broad schemas and do not delete inspection data.

- [ ] **Step 4: Validate locally without remote application.**

Run the local migration/test command supported by the repository. Inspect the SQL and migration list. Do not run \`supabase db push --linked\`.

- [ ] **Step 5: Commit the cleanup migration without deploying it.**

\`\`\`powershell
$migration = Get-ChildItem supabase/migrations -Filter '*_remove_device_enrollment_infrastructure.sql' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
git add -- $migration.FullName
git commit -m "feat: prepare device enrollment cleanup"
\`\`\`

## Task 9: Final verification and handoff

**Files:**
- Modify: documentation only if verification discovers a durable operational rule
- Do not modify production configuration or remote database in this task

- [ ] **Step 1: Run final web checks.**

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp-pal-web
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
\`\`\`

- [ ] **Step 2: Run final Flutter checks.**

\`\`\`powershell
Set-Location C:\\Users\\mklgr\\Codes\\pelp_pal_v2
flutter analyze
flutter test
\`\`\`

- [ ] **Step 3: Review the final diffs and migration safety.**

Confirm no unrelated files were staged, no secrets were added, no remote migration was applied, no inspection data was deleted, and the cleanup migration is blocked by unresolved ownership rather than silently proceeding.

- [ ] **Step 4: Report deployment gates.**

The handoff must distinguish:

- local code/tests passing;
- additive migration ready but not remotely applied;
- cleanup migration created but not remotely applied;
- live Supabase verification still required;
- Flutter retirement intentionally deferred.

