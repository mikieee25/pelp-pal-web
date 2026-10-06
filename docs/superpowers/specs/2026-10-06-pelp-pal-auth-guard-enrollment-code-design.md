# PELP Pal Web Authentication Guard and Enrollment Code Issuance

**Status:** Approved for implementation  
**Date:** 2026-10-06  
**Scope:** PELP Pal Web workspace access and administrator browser-enrollment code issuance

## Decision

Require an authenticated Supabase account before rendering any workspace route under the `(workspace)` route group. Keep the landing page, sign-in page, and browser-enrollment page public. Add an administrator-only enrollment-code panel to the Account screen, backed by a protected PELP Pal V2 Edge Function that calls the existing secure database code generator server-side.

The browser must never call the privileged `generate_code` database function directly and must never receive a service-role or secret key.

## Existing contract evidence

- `src/app/(workspace)/layout.tsx` currently renders `AppShell` and `SyncRuntimeBoundary` without an authentication check.
- `signInWithCredentials` calls the shared `account-login` Edge Function, establishes a Supabase browser session with `auth.setSession`, and stores the normalized username in the local session store.
- `/enroll` uses the public `enroll-device` Edge Function and must remain accessible before a browser has an account session or device enrollment.
- The shared PELP Pal V2 database already defines `public.generate_code(username)`. It stores only a hash, expires previous usable codes for the target account, and returns a fresh six-digit code once.
- The current database grant restricts `generate_code` to `service_role`, so a browser client cannot and must not invoke it directly.

## Route access policy

### Public routes

- `/`
- `/login`
- `/enroll`
- `/robots.txt`
- `/manifest.webmanifest`

### Authenticated workspace routes

Every route under `src/app/(workspace)` requires a valid Supabase Auth session, including:

- `/dashboard`
- `/lookup`
- `/activity`
- `/summary`
- `/report`
- `/sync`
- `/account`
- `/store`
- `/inspect/[inspectionId]`
- `/personnel`

The current application stores the Supabase session in the browser client rather than server-readable cookies. Therefore the first implementation uses a client-side workspace gate at the shared workspace layout boundary. It must check the persisted Supabase session before rendering workspace content and redirect unauthenticated users to `/login?next=<safe-internal-path>`.

The gate is a UX and route-rendering boundary; all sensitive data and mutations remain protected by Supabase Auth, RLS, or authenticated Edge Functions. A future SSR-cookie migration may strengthen server-side enforcement but is outside this change.

### Redirect behavior

- If the session is missing or invalid, replace the current history entry with `/login?next=<path-and-query>`.
- Only same-origin paths beginning with `/` are accepted as `next` destinations. Reject protocol-relative or external URLs and fall back to `/dashboard`.
- After successful sign-in, navigate to the sanitized `next` destination; otherwise use `/dashboard`.
- While the session check is pending, render the existing application loading pattern and do not render workspace data or controls.
- If a signed-in session expires or is explicitly signed out, the gate redirects on the next auth-state change.

## Enrollment-code flow

### User experience

Add an `Enrollment code` panel to the existing Account screen, shown only when the browser is enrolled, the local device role is `admin`, and the current Supabase session is valid.

The panel includes:

- Target personnel username input.
- A `Generate code` button.
- Loading, success, and actionable error states.
- The six-digit code displayed in a readable, copy-friendly format.
- Expiration information returned by the backend.
- A `Copy code` button with clipboard failure feedback.
- A reminder that generating a new code invalidates any still-usable code for that target account.

The plaintext code is held only in component state until the user leaves or generates another code. It is never stored in IndexedDB, local storage, a URL, or a browser log.

Non-admin, unenrolled, revoked, or inactive users must not see the panel. Directly forged function calls still receive a server-side authorization error.

### Backend boundary

Add a protected PELP Pal V2 Edge Function:

```text
POST /functions/v1/issue-enrollment-code
```

Request:

```json
{
  "target_username": "epred.one"
}
```

Response:

```json
{
  "code": "123456",
  "assigned_username": "epred.one",
  "expires_at": "2026-10-13T00:00:00.000Z"
}
```

The Edge Function must:

1. Validate the bearer token with the existing shared Auth helper.
2. Resolve the active `organization_accounts` row for the caller.
3. Require the caller to be an active Admin.
4. Resolve the target active account within the caller’s organization.
5. Call the privileged `generate_code` function only from the protected server environment.
6. Return only the plaintext code, assigned username, and expiration timestamp.
7. Return generic client-safe errors without exposing SQL errors, service credentials, hashes, or internal identifiers.

The backend must not accept an organization ID from the browser. Organization scope is derived from the authenticated caller. A target username that is missing, inactive, archived, or outside the organization returns a safe not-found response.

If the existing one-argument `generate_code` function cannot safely resolve a duplicate username across organizations when called by the service client, add a server-only organization-scoped database function or migration-compatible overload. Preserve compatibility with existing one-argument callers where possible.

## Web client boundary

Add a typed `enrollment-code-client.ts` adapter that invokes the protected Edge Function through the existing Supabase browser client. It must:

- Normalize the target username before sending it.
- Map snake_case response fields to camelCase.
- Surface structured backend errors as safe `Error` messages.
- Never call `.rpc('generate_code')` from browser code.

Add a reusable `WorkspaceAuthGate` client component or equivalent layout boundary. It owns only session status and redirect behavior; it must not own account, device, catalog, or inspection data.

## Failure handling

- Missing session: redirect to sign-in without rendering workspace content.
- Invalid or expired session: clear the local session identity, redirect to sign-in, and preserve a safe return path.
- Supabase availability failure during the gate check: show an explicit sign-in/service-unavailable state rather than silently treating the user as authenticated.
- Enrollment-code generation failure: preserve the Account screen and show the backend’s safe actionable message.
- Clipboard failure: keep the code visible and provide a manual-copy instruction.
- A new code replaces the target account’s still-usable code according to the existing database function contract.
- No code is written to local device records or inspection data.

## Security constraints

- No service-role, secret, or privileged database key in browser code or `NEXT_PUBLIC_` variables.
- No authorization based on editable user metadata.
- Admin authorization is enforced by the Edge Function and the database function, not only by hidden UI.
- Target account and organization scope are derived server-side.
- Plaintext enrollment codes are returned only to the authenticated admin that requested them and are not persisted by the web client.
- Workspace pages remain `noindex` and are not public content.

## Verification plan

### Web unit tests

- Workspace gate shows loading while checking the session.
- Workspace gate redirects unauthenticated users to `/login?next=...`.
- Workspace gate renders children for a valid session.
- External and malformed `next` values fall back to `/dashboard`.
- Successful login uses the safe `next` destination.
- Admin Account view shows the enrollment-code panel.
- EPRED, Guest, unenrolled, revoked, and inactive states do not show the panel.
- Client request/response mapping and safe error handling work as specified.
- Code generation clears or replaces previous plaintext state appropriately.

### Browser tests

- A signed-out direct workspace visit is redirected to `/login`.
- A signed-in user can return to the originally requested workspace route.
- The enrollment route remains accessible while signed out.
- Admin Account displays the code-generation controls when the protected function is mocked.
- Non-admin Account does not display code-generation controls.

### Backend checks

- Edge Function authorization matrix covers Admin, EPRED, Guest, inactive, revoked, missing target, inactive target, and cross-organization target.
- Duplicate usernames across organizations cannot cause code issuance for the wrong organization.
- The function returns no hashes, service credentials, or internal SQL errors.
- Existing device enrollment and Flutter code-generation behavior remains compatible.

### Rollout

1. Add and locally review the Web route gate and client adapter.
2. Add the protected Edge Function and any required PELP Pal V2 migration locally.
3. Run web and backend checks without applying remote changes.
4. Deploy to the staging Supabase project only after explicit deployment approval.
5. Verify Admin, EPRED, Guest, inactive, revoked, cross-organization, and enrollment flows in staging.
6. Deploy the Vercel build only after staging verification and separate deployment approval.
