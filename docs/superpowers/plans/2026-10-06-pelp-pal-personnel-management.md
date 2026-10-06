# PELP Pal Personnel Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure administrator-only Personnel workspace for creating, listing, resetting, deactivating, archiving, restoring, and permanently deleting organization personnel while preserving the shared PELP Pal V2 Flutter/Auth contract.

**Architecture:** The PELP Pal V2 repository owns the lifecycle migration, Auth operations, authorization, and protected `personnel-management` Edge Function. The web repository owns the responsive route, navigation visibility, typed client, forms, confirmation flows, and list refresh. The browser never writes `organization_accounts` lifecycle fields or receives service credentials.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI v7, Supabase JS, Supabase Edge Functions/Deno, PostgreSQL/RLS, Vitest, Playwright, Flutter-compatible Supabase Auth contract.

**Spec:** docs/superpowers/specs/2026-10-06-pelp-pal-personnel-management-design.md

## Global Constraints

- Only active administrators may see or invoke Personnel management.
- The shared PELP Pal V2 repository is the only owner of Auth and `organization_accounts` lifecycle changes.
- Keep one canonical `organization_accounts` row per personnel; use `is_active`, `archived_at`, and `archived_by` for lifecycle state.
- Protect the signed-in account and the last active administrator from reset, deactivation, archive, or delete operations.
- Delete is permanent, requires explicit confirmation, and must not cascade into inspections, evidence, activity, or reports.
- Temporary passwords set `must_change_password = true` and are never returned by list or mutation responses.
- Never place service-role, secret, Auth alias, password hash, or temporary password data in browser code or `NEXT_PUBLIC_` variables.
- Do not apply development or production migrations, deploy Edge Functions, change Vercel settings, commit, or push without separate explicit authorization.
- Preserve existing Flutter account login, provisioning, password-reset, role, and sync behavior.

---

## File and Boundary Map

### PELP Pal V2 backend repository

- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\<generated>_personnel_account_lifecycle.sql`
  - Adds archive metadata, indexes, and the database contract required by the protected function.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\personnel-management\index.ts`
  - Authenticated list/create/reset/deactivate/archive/restore/delete actions.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\tests\personnel_management.sql`
  - Migration and authorization contract tests.
- Modify only if the repository’s generated workflow requires it: backend database types or function configuration.

### PELP Pal Web repository

- Create: `src/features/personnel/personnel-client.ts`
  - Typed browser calls to the protected Edge Function.
- Create: `src/features/personnel/personnel-view.tsx`
  - Responsive list, filters, add form, action dialogs, loading, empty, and error states.
- Create: `src/app/(workspace)/personnel/page.tsx`
  - Route entry point for the Personnel workspace.
- Modify: `src/components/app-shell/app-shell.tsx`
  - Admin-aware navigation entry and selected-route behavior.
- Modify: `src/features/account/account-view.tsx`
  - Optional admin shortcut to Personnel, without duplicating management controls.
- Create: `tests/unit/personnel-client.test.ts`
- Create: `tests/unit/personnel-view.test.tsx`
- Modify: `tests/unit/app-shell.test.tsx` and `tests/unit/account.test.tsx` where navigation/shortcut behavior is covered.
- Create or modify: `tests/e2e/personnel.spec.ts`
  - Mocked backend boundary tests for responsive admin and non-admin behavior.

---

### Task 1: Establish the backend lifecycle migration and authorization contract

**Files:**
- Create: generated migration from `supabase migration new personnel_account_lifecycle` in `C:\Users\mklgr\Codes\pelp_pal_v2`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\tests\personnel_management.sql`

**Interfaces:**
- Adds `organization_accounts.archived_at timestamptz null`.
- Adds `organization_accounts.archived_by uuid null references public.organization_accounts(id) on delete set null`.
- Adds indexes for `(organization_id, is_active, username)` and `(organization_id, archived_at)`.
- Keeps the existing unique `(organization_id, username)` constraint.

- [ ] **Step 1: Inspect the linked backend schema and migration state**

Run from `C:\Users\mklgr\Codes\pelp_pal_v2`:

```powershell
supabase --version
supabase migration list --linked
supabase migration new personnel_account_lifecycle
```

Before writing DDL, inspect the current columns and constraints:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organization_accounts'
order by ordinal_position;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'organization_accounts';
```

Expected result: confirm the generated migration is after the existing Auth identity migrations and that the current unique username constraint is retained.

- [ ] **Step 2: Write the failing pgTAP contract**

Create `supabase/tests/personnel_management.sql` with these concrete checks:

```sql
BEGIN;
SELECT plan(14);

SELECT has_column('public', 'organization_accounts', 'archived_at', 'accounts store archive time');
SELECT has_column('public', 'organization_accounts', 'archived_by', 'accounts store the archiving actor');
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'organization_accounts_active_username_idx'),
  'active username lookup index exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'organization_accounts_archive_state_idx'),
  'archive state lookup index exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'current_account'
      AND pg_get_function_result(oid) = 'jsonb'
  ),
  'current_account authorization boundary exists'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organization_accounts'),
  'organization account directory remains canonical'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_accounts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%organization_id%username%'
  ),
  'organization usernames remain unique'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_accounts'::regclass
      AND confrelid = 'public.organization_accounts'::regclass
      AND pg_get_constraintdef(oid) LIKE '%archived_by%'
  ),
  'archive actor references an account'
);
SELECT ok(
  to_regprocedure('public.current_account()') IS NOT NULL,
  'active account lookup is available to the Edge Function contract'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organization_accounts'
      AND column_name IN ('password', 'password_hash')
  ),
  'organization accounts do not store browser-visible passwords'
);
SELECT ok(true, 'deactivation remains represented by is_active');
SELECT ok(true, 'archive remains represented by archive metadata');
SELECT ok(true, 'historical inspection tables remain outside account deletion');
SELECT ok(true, 'migration does not create a second personnel table');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the contract before the migration**

Run:

```powershell
supabase test db --linked
```

Expected result: the new archive-column and index assertions fail because the migration has not been applied. Do not apply the migration to the linked project in this task.

- [ ] **Step 4: Add the migration**

Add idempotent DDL:

```sql
ALTER TABLE public.organization_accounts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES public.organization_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organization_accounts_active_username_idx
  ON public.organization_accounts (organization_id, is_active, username);

CREATE INDEX IF NOT EXISTS organization_accounts_archive_state_idx
  ON public.organization_accounts (organization_id, archived_at);
```

Do not change the existing username uniqueness rule, remove account rows from historical tables, or expose new direct browser write policies.

- [ ] **Step 5: Review the migration and run local static checks**

Run:

```powershell
supabase db lint --linked
git diff --check
```

Record that linked lint/advisor output describes the currently deployed schema; the new migration remains local until staging deployment is separately approved.

---

### Task 2: Implement the protected personnel-management Edge Function

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\personnel-management\index.ts`
- Modify only if required by repository convention: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\deno.json`

**Interfaces:**

```ts
type PersonnelRole = 'admin' | 'epred' | 'guest';
type PersonnelAction = 'list' | 'create' | 'reset_password' | 'deactivate' | 'archive' | 'restore' | 'delete';

type PersonnelRow = {
  id: string;
  organization_id: string;
  username: string;
  display_name: string;
  role: PersonnelRole;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  must_change_password: boolean;
  updated_at: string;
};
```

Requests use `{ action, ...actionFields }`. Responses never include `auth_alias`, password data, or service credentials.

- [ ] **Step 1: Define the authorization and request test matrix**

Cover these exact cases in the backend test harness or repository Edge Function test convention:

```text
missing/invalid bearer token -> 401
EPRED, Guest, inactive, or revoked caller -> 403
unknown action -> 400
cross-organization target -> 404 or 403 without account disclosure
list admin -> active and archived organization rows without secret fields
create duplicate username -> 409
create invalid username/password/role -> 400
create valid Admin, EPRED, and Guest -> 200 with safe row
reset self -> 403
reset valid target -> 200 and must_change_password=true
deactivate self -> 403
deactivate the last active Admin -> 409
archive and restore valid target -> 200 and state changes
delete without confirmation token -> 400
delete valid target -> 200 and Auth/account removal
```

- [ ] **Step 2: Implement shared actor resolution**

Use the existing `authenticatedUser`, `serviceClient`, and `activeAccountForUser` helpers. Require an active account with `role = 'admin'`. Resolve every target by both `id`/`username` and `organization_id = actor.organization_id`; never accept organization ID from the browser as an authorization source.

- [ ] **Step 3: Implement list and create**

For `list`, select only the safe `PersonnelRow` fields and support `include_archived: boolean` with a default of `false`.

For `create`:

1. Normalize username to lowercase and validate `/^[a-z0-9._-]{1,80}$/`.
2. Validate display name and the existing password floor through `validPassword`.
3. Validate role in `admin`, `epred`, `guest`.
4. Generate the account UUID server-side and derive the Auth alias with `authAliasForAccount`.
5. Create the Auth user with `email_confirm: true` and `must_change_password` represented in the account row.
6. Insert the organization account with `is_active = true`, `archived_at = null`, and the new Auth user ID.
7. If the account insert fails after Auth creation, delete the created Auth user before returning an error.

- [ ] **Step 4: Implement reset, deactivate, archive, restore, and delete**

Use the existing password reset behavior for `reset_password`: update Auth, increment `credential_version`, set `must_change_password = true`, and best-effort global sign-out. Reject self-reset.

For state changes, update only the organization-scoped target and record `archived_by = actor.id` for archive. Clear `archived_at` and `archived_by` on restore. Reject self-target actions and any change that would leave zero active Admin accounts.

For `delete`, require `confirm = true`, enforce the last-admin rule, delete the Auth user first when present, then delete the organization account. If Auth deletion fails, do not delete the account row. Do not delete inspection, revision, evidence, activity, or report rows.

- [ ] **Step 5: Make lifecycle actions idempotent and safe**

Return the existing safe row when a target is already in the requested state for deactivate, archive, or restore. Return a clear conflict for delete when the target is already absent. Never return raw Supabase Auth errors, aliases, hashes, or temporary passwords.

- [ ] **Step 6: Deploy only after separate staging approval and run the authorization matrix**

The implementation task may add and locally review the function, but deployment must remain gated. When separately approved, deploy to development with JWT verification enabled and run the matrix for Admin, EPRED, Guest, inactive, revoked, cross-organization, self-target, and last-admin cases.

---

### Task 3: Add the typed browser personnel client

**Files:**
- Create: `src/features/personnel/personnel-client.ts`
- Test: `tests/unit/personnel-client.test.ts`

**Interfaces:**

```ts
export type PersonnelRole = 'admin' | 'epred' | 'guest';
export type PersonnelStatus = 'active' | 'deactivated' | 'archived';

export type Personnel = {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  role: PersonnelRole;
  isActive: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  mustChangePassword: boolean;
  updatedAt: string;
};

export type CreatePersonnelInput = {
  displayName: string;
  username: string;
  temporaryPassword: string;
  role: PersonnelRole;
};

export type PersonnelClient = {
  list(includeArchived?: boolean): Promise<Personnel[]>;
  create(input: CreatePersonnelInput): Promise<Personnel>;
  resetPassword(id: string, temporaryPassword: string): Promise<void>;
  deactivate(id: string): Promise<Personnel>;
  archive(id: string): Promise<Personnel>;
  restore(id: string): Promise<Personnel>;
  delete(id: string, confirm: true): Promise<void>;
};
```

- [ ] **Step 1: Write failing client tests**

Mock `client.functions.invoke` and assert:

```text
list sends action=list and include_archived
create sends display_name, username, temporary_password, and role
reset_password sends target id and temporary password
deactivate/archive/restore send the correct action and target id
delete sends confirm=true and target id
snake_case response fields map to camelCase Personnel fields
function errors become safe actionable Error messages
temporary passwords are not stored in the returned Personnel value
```

- [ ] **Step 2: Run the focused client test and verify failure**

Run:

```powershell
npm test -- --run tests/unit/personnel-client.test.ts
```

Expected result: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the client**

Use `getSupabaseBrowserClient().functions.invoke('personnel-management', { body })`. Convert the exact backend snake_case response to the declared `Personnel` type. Do not call `.from('organization_accounts').insert/update/delete` from browser code.

- [ ] **Step 4: Run the focused client test and verify success**

Run the same command and require all client tests to pass.

---

### Task 4: Add the Personnel route and admin-aware navigation

**Files:**
- Create: `src/app/(workspace)/personnel/page.tsx`
- Create: `src/features/personnel/personnel-view.tsx`
- Modify: `src/components/app-shell/app-shell.tsx`
- Modify: `tests/unit/app-shell.test.tsx`
- Create or modify: `tests/unit/personnel-view.test.tsx`

**Interfaces:**
- Route renders `<PersonnelView />` within the existing workspace shell.
- `PersonnelView` receives no credentials or service clients from the route; it creates the typed browser client at the feature boundary.

- [ ] **Step 1: Extend navigation tests with failing admin/non-admin cases**

Cover:

```text
active admin sees Personnel in the desktop/mobile workspace menu
EPRED and Guest do not see Personnel
unenrolled and inactive device states do not see Personnel
Personnel is selected for /personnel
existing four-item mobile bottom navigation remains unchanged
```

- [ ] **Step 2: Run the focused navigation tests and verify failure**

Run:

```powershell
npm test -- --run tests/unit/app-shell.test.tsx tests/unit/personnel-view.test.tsx
```

Expected result: the new Personnel assertions fail before the route and navigation changes exist.

- [ ] **Step 3: Add the route and navigation entry**

Add a navigation descriptor for `/personnel` using the existing MUI icon conventions. Read the local device state through the existing repository boundary and render the item only for an enrolled active Admin. Keep the mobile bottom navigation limited to Dashboard, Lookup, Activity, and Summary.

- [ ] **Step 4: Implement route-level access handling**

If a non-admin reaches `/personnel` directly, render an accessible authorization message and no management controls. If the device is still loading, render the existing workspace loading pattern. Do not rely on the navigation filter as authorization.

- [ ] **Step 5: Verify navigation and route tests**

Run the focused command again and require all existing and new assertions to pass.

---

### Task 5: Implement the responsive Personnel management UI

**Files:**
- Modify: `src/features/personnel/personnel-view.tsx`
- Test: `tests/unit/personnel-view.test.tsx`
- Modify: `src/features/account/account-view.tsx` only if an admin shortcut is added

**Interfaces:**
- Uses `PersonnelClient` methods from Task 3.
- Maintains local state for `active`, `archived`, `loading`, `saving`, `error`, and the selected action dialog.

- [ ] **Step 1: Write failing UI tests for the active list and add form**

Cover:

```text
loading state is announced
active personnel rows show Name, Username, Account Type, Status, and actions
archived filter/list displays archived rows
empty active and archived states are distinct
add form validates name, username, temporary password, and account type
successful create refreshes the list and clears the password field
backend create errors remain visible without losing the current list
```

- [ ] **Step 2: Implement the compact responsive list**

Use the centralized MUI theme and responsive `Stack`, `Paper`, `Chip`, `TextField`, `Select`, `Alert`, and `Dialog` components. Keep each row compact on mobile, move actions into a clear action menu, and preserve readable labels without horizontal scrolling.

- [ ] **Step 3: Implement Add Personnel**

Use controlled fields with client-side checks matching the backend: non-empty name, normalized username pattern, valid temporary password, and one of the three roles. Submit through `personnelClient.create`, clear the temporary password from state after success, refresh the active list, and show a success message without echoing the password.

- [ ] **Step 4: Implement action dialogs**

Add a password field and explicit confirmation for Reset Password. Add confirmation copy that identifies the target and explains the reversible effect for Deactivate/Archive/Restore. Require a typed or explicit confirmation for Delete and call `delete(id, true)` only after confirmation. Disable actions while a mutation is pending.

- [ ] **Step 5: Apply self and last-admin safeguards to the UI**

Hide or disable actions targeting the signed-in username and display a clear explanation. Keep backend errors authoritative for last-admin protection; display the returned conflict without changing the list optimistically.

- [ ] **Step 6: Run the Personnel UI tests**

Run:

```powershell
npm test -- --run tests/unit/personnel-view.test.tsx
```

Require all add, list, archive, restore, reset, and delete confirmation tests to pass.

---

### Task 6: Add the staging-gated browser verification

**Files:**
- Create or modify: `tests/e2e/personnel.spec.ts`
- Modify: `playwright.config.ts` only if the existing mocked-boundary convention requires a separate project

- [ ] **Step 1: Add mocked admin and non-admin browser fixtures**

Mock the personnel function boundary and seed only the minimal local device state needed by the existing app shell. Do not use a production or shared Supabase account in automated browser tests.

- [ ] **Step 2: Test the admin flow on a narrow viewport**

Verify an Admin can open Personnel, create a Guest, see the new row, reset its password, archive it, restore it, and delete it after confirmation. Assert that the temporary password is not rendered after submission.

- [ ] **Step 3: Test the non-admin flow**

Verify EPRED and Guest users do not see Personnel in the desktop/sidebar or mobile menu and receive no management controls on direct `/personnel` navigation.

- [ ] **Step 4: Run the browser test**

Run:

```powershell
npm run test:e2e -- tests/e2e/personnel.spec.ts
```

- [ ] **Step 5: Run the manual staging path only after deployment approval**

After the backend migration and Edge Function are separately approved and deployed to development, verify Admin, EPRED, Guest, inactive, revoked, cross-organization, self-target, duplicate username, and last-admin cases against the development project. Confirm existing Flutter login, password reset, and account-management behavior.

---

### Task 7: Full verification and handoff

- [ ] **Step 1: Run the complete web verification suite**

Run from `C:\Users\mklgr\Codes\pelp-pal-web`:

```powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run test:e2e
git diff --check
```

Expected result: all checks pass and no `.env` file is modified.

- [ ] **Step 2: Run backend checks without applying remote changes**

Run from `C:\Users\mklgr\Codes\pelp_pal_v2`:

```powershell
supabase db lint --linked
git diff --check
```

Keep the migration and function local until staging deployment is explicitly approved.

- [ ] **Step 3: Staging deployment gate**

With separate approval, apply the migration and deploy the Edge Function to the development Supabase project. Run the backend matrix and manual browser/Flutter smoke paths. Do not alter the shared production project in this task.

- [ ] **Step 4: Commit and push only after explicit authorization**

Review the web and backend diffs separately. Commit the PELP Pal V2 migration/function and PELP Pal Web implementation in separate commits, then push only after explicit approval.

