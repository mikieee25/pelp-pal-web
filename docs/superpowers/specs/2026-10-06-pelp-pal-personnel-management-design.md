# PELP Pal Personnel Management

**Status:** Approved  
**Date:** 2026-10-06  
**Scope:** PELP Pal Web Personnel screen plus the shared PELP Pal V2 Supabase account contract

## Decision

Add an administrator-only **Personnel** workspace screen for managing organization personnel. The screen will be available from the desktop sidebar and mobile workspace menu only to active administrators. The browser will consume a protected PELP Pal V2 backend boundary for account creation, password reset, activation, archiving, restoration, and permanent deletion.

The web client must not create Supabase Auth users directly, expose service-role credentials, or write `organization_accounts` lifecycle fields directly. The backend remains the authority for organization scope, role authorization, account state, and Auth identity lifecycle.

## Existing contract evidence

- `organization_accounts` already stores organization, username, display name, role, active state, and the Auth identity mapping.
- The existing PELP Pal V2 account-management flow supports Admin, EPRED, and Guest roles, temporary passwords, forced first-login password change, password reset, and protection against modifying the signed-in account.
- The current web Account screen already reads the enrolled device role and is the appropriate place to expose an admin-only personnel entry point.
- Existing password reset and account provisioning Edge Functions must remain compatible with the Flutter account-management contract.
- `current_account()` is the backend authorization boundary and must be used for administrator and organization checks.

## User experience

### Navigation

Add a `Personnel` item to the workspace navigation and mobile menu. It must:

- appear for active administrators;
- be absent for EPRED, Guest, inactive, and unenrolled users;
- be protected by the route and backend even if a non-admin manually enters `/personnel`.

The existing four-item mobile bottom navigation remains unchanged. Personnel is accessed through the mobile workspace menu to avoid crowding the bottom navigation.

### Personnel screen

The screen contains:

- an active personnel list;
- an archived personnel list or status filter;
- a responsive Add Personnel form or dialog;
- clear empty, loading, and error states;
- row actions appropriate to the current account state.

Each personnel row displays:

- Name;
- Username;
- Account Type: Admin, EPRED, or Guest;
- Status: Active, Deactivated, or Archived;
- last updated timestamp;
- action menu.

### Add Personnel

The form accepts:

- Name;
- Username;
- Temporary Password;
- Account Type: Admin, EPRED, or Guest.

On success, the backend creates or provisions the corresponding Auth identity, creates the organization account mapping, marks the account active, and sets `must_change_password = true`. The UI must not display the password after the operation completes, except for the controlled form value before submission.

Usernames are normalized consistently with the existing login contract. Duplicate usernames within the organization produce an actionable validation error.

### Account actions

- **Reset Password:** Admin enters a new temporary password. The backend updates the Auth password, increments the credential version, and sets `must_change_password = true`.
- **Deactivate:** Reversible. The account remains in the organization directory but cannot sign in. Existing sessions must be rejected by the active-account checks on subsequent protected requests.
- **Archive:** Reversible. The account is marked archived and excluded from the active personnel list. Archive metadata records who performed the action and when.
- **Restore:** Reversible for archived accounts. Restoring clears archive metadata and returns the account to the active list without changing its password.
- **Delete:** Permanent and protected by an explicit confirmation dialog. It removes the organization account and Auth identity only after server-side validation. Historical inspection/activity records retain their stored username or display identity and are not deleted.

The signed-in administrator cannot reset, deactivate, archive, restore, or delete their own account. The final active administrator cannot be deactivated, archived, or deleted.

## Data and authorization contract

The shared PELP Pal V2 repository owns the account lifecycle changes. The preferred protected endpoint is an Edge Function with explicit actions:

```text
POST /functions/v1/personnel-management
```

Supported actions:

```text
list
create
reset_password
deactivate
archive
restore
delete
```

Every action must:

1. validate the authenticated bearer token;
2. resolve the active account through the existing Auth mapping;
3. require `role = 'admin'` and `is_active = true`;
4. scope reads and writes to the caller’s organization;
5. prevent self-modification;
6. prevent removal of the last active administrator;
7. return safe user-facing errors without exposing Auth aliases, hashes, service keys, or internal credentials.

The account table should gain lifecycle metadata sufficient to distinguish ordinary deactivation from archival:

- `archived_at TIMESTAMPTZ NULL`;
- `archived_by UUID NULL` referencing the account that performed the archive, where the existing schema and migration conventions support it.

If a separate archive table is not needed by the Flutter contract, retain one canonical row in `organization_accounts` and use these fields plus `is_active` for lifecycle state. Do not create a second web-only personnel table.

The backend must revoke or invalidate the target’s active access according to the existing Auth/session contract. Deactivation and archival must prevent future login even if the local browser still has stale account data.

## Data flow

```text
Personnel UI
    -> protected personnel-management Edge Function
        -> current_account() authorization
        -> organization_accounts lifecycle update
        -> Supabase Auth admin operation when required
    <- safe result / actionable error
```

The web client refreshes the list after every successful mutation. Local IndexedDB account records are refreshed through the existing sync/account path rather than being edited independently by the Personnel screen.

## Failure handling

- Invalid or duplicate usernames stop creation before any partial account is left behind.
- If Auth creation succeeds but organization-account creation fails, the backend performs compensating cleanup.
- Password reset failures leave the previous credential state unchanged.
- Deactivate, archive, and restore are idempotent for the requested target state.
- Delete requires a fresh server-side authorization check and does not cascade into inspections, evidence, activity, or reports.
- A failed action leaves the current list visible and reports an actionable error.
- Non-admin direct navigation and forged function requests receive an authorization error.

## Compatibility and rollout

1. Add the lifecycle migration and backend authorization tests in PELP Pal V2.
2. Implement and test the personnel-management Edge Function against the development project only.
3. Implement the web Personnel route, navigation visibility, forms, action confirmations, and responsive states.
4. Verify Admin, EPRED, Guest, inactive, revoked, cross-organization, self-target, and last-admin cases.
5. Confirm existing Flutter account management and login behavior continues to work.
6. Apply to the shared PELP Pal V2 project only after staging verification and separate deployment approval.

## Verification plan

### Web

- Admin sees Personnel navigation and route content.
- EPRED, Guest, inactive, and unenrolled users do not see the navigation entry or controls.
- Admin can create a personnel record for each supported account type.
- Temporary-password and username validation errors are clear.
- Admin can reset, deactivate, archive, restore, and permanently delete another account through confirmation flows.
- Self-modification and last-admin protections are reflected in the UI.
- Mobile layout remains usable in the existing Pixel, iPhone, and iPad viewport suite.

### Backend

- Every action is organization-scoped and administrator-authorized.
- Auth and organization-account creation is compensating/atomic on failure.
- Deactivation and archival block future login.
- Delete does not remove historical inspection or activity records.
- Existing Flutter account-management and password-reset contract remains compatible.

### Security

- No service-role or secret key reaches browser code.
- RLS and function privileges are reviewed with Supabase advisors.
- Auth aliases, password hashes, temporary passwords, and internal tokens are never returned by the list endpoint.
