# PELP Pal Web Authentication Guard and Enrollment Code Issuance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax to track progress.

**Goal:** Require Supabase authentication before any workspace screen renders and give active administrators a secure Account workflow for generating browser-enrollment codes.

**Architecture:** Add a client-side authentication gate at the existing `(workspace)` layout because the current Supabase browser session is persisted in browser storage rather than SSR-readable cookies. Add a typed browser client and Account panel that call a protected PELP Pal V2 Edge Function; the Edge Function validates the active administrator and organization scope before invoking the existing privileged enrollment-code generator.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI v7, Supabase JS, Supabase Edge Functions/Deno, PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-pelp-pal-auth-guard-enrollment-code-design.md`

## Global Constraints

- Keep `/`, `/login`, `/enroll`, `/robots.txt`, and `/manifest.webmanifest` public.
- Require a valid Supabase Auth session for every route under `src/app/(workspace)`.
- Redirect unauthenticated users to `/login?next=<safe-internal-path>` without rendering workspace content.
- Only accept same-origin `next` paths beginning with `/`; reject protocol-relative and external destinations.
- Never call `public.generate_code` from browser code.
- Never expose service-role, secret, or privileged database keys to the browser.
- Derive organization scope from the authenticated caller on the server.
- Only active administrators may issue enrollment codes.
- Do not persist plaintext enrollment codes in IndexedDB, local storage, URLs, or logs.
- Preserve the existing public browser-enrollment route and Flutter/device-enrollment contract.
- Do not apply migrations, deploy Edge Functions, change Vercel settings, commit, or push without separate explicit authorization.

## Review Focus

- A stale or invalid persisted Supabase session must redirect before any workspace content or sync runtime is rendered; covered in Task 1 gate tests.
- An external `next` value such as `https://example.com` or `//example.com` must resolve to `/dashboard`; covered in Task 1 redirect tests.
- Duplicate usernames in different organizations must not let an admin issue a code for another organization; covered in Task 2 backend contract tests.
- A valid admin session with a missing or inactive target must receive a safe error and no code; covered in Task 2 and Task 3 tests.
- Clipboard denial must leave the generated code visible and provide manual-copy guidance; covered in Task 4 UI tests.

## File and Boundary Map

### PELP Pal Web

- Create `src/features/auth/workspace-auth-gate.tsx` for session status and redirect behavior only.
- Create `src/features/enrollment/enrollment-code-client.ts` for the typed Edge Function adapter.
- Modify `src/app/(workspace)/layout.tsx` to place the gate outside `AppShell` and `SyncRuntimeBoundary`.
- Modify `src/app/login/page.tsx` to consume and sanitize `next` after successful sign-in.
- Modify `src/features/account/account-view.tsx` to render the admin-only code panel.
- Create `src/features/account/enrollment-code-panel.tsx` if the Account screen needs a focused UI boundary.
- Create or modify `tests/unit/auth/workspace-auth-gate.test.tsx` and `tests/unit/login.test.tsx`.
- Create `tests/unit/enrollment/enrollment-code-client.test.ts`.
- Modify `tests/unit/account.test.tsx` for administrator and non-administrator panel behavior.
- Create or modify `tests/e2e/auth-guard.spec.ts` and `tests/e2e/account-enrollment-code.spec.ts`.

### PELP Pal V2

- Create `supabase/functions/issue-enrollment-code/index.ts`.
- Create a generated migration only if the existing `generate_code(text)` contract needs an organization-scoped server-only overload.
- Extend `supabase/tests/` with enrollment-code authorization assertions when the local pgTAP setup supports the function boundary.

## Task 1: Implement the workspace authentication gate and safe return path

**Files:**

- Create: `src/features/auth/workspace-auth-gate.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/app/login/page.tsx`
- Create: `tests/unit/auth/workspace-auth-gate.test.tsx`
- Modify: `tests/unit/login.test.tsx`

**Interfaces:**

- `WorkspaceAuthGate({ children }: Readonly<{ children: ReactNode }>): JSX.Element` renders a loading state, the workspace children, or a redirecting state.
- `sanitizeNextPath(value: string | null | undefined): string` returns a same-origin internal path or `/dashboard`.
- The gate uses `getSupabaseBrowserClient().auth.getSession()` and subscribes to `onAuthStateChange`; it does not read account, device, catalog, or inspection data.

- [ ] **Step 1: Write failing gate tests.**

  Mock the Supabase browser client, Next router, and current pathname. Assert that:

  ```text
  a pending getSession result renders role=status and not the workspace child;
  a null session calls router.replace('/login?next=/lookup?q=air') and never renders the child;
  a valid session renders the child and does not redirect;
  SIGNED_OUT after a valid session redirects to a safe login path;
  sanitizeNextPath('https://example.com') returns '/dashboard';
  sanitizeNextPath('//example.com') returns '/dashboard';
  sanitizeNextPath('/lookup?q=air') preserves the internal path.
  ```

- [ ] **Step 2: Run the gate tests and verify the expected failure.**

  Run:

  ```powershell
  npm test -- --run tests/unit/auth/workspace-auth-gate.test.tsx
  ```

  Expected: FAIL because the gate module and layout integration do not exist.

- [ ] **Step 3: Implement the gate and integrate it into the workspace layout.**

  Place `WorkspaceAuthGate` before `AppShell` and `SyncRuntimeBoundary` so unauthenticated users cannot initialize workspace sync behavior. Capture the current pathname and query string only for the internal redirect target. On missing/error sessions, clear the local session identity and replace to the sanitized login path. Keep the existing loading geometry from `src/app/loading.tsx` or a matching accessible MUI loading surface.

- [ ] **Step 4: Add safe post-login navigation.**

  Read the `next` query parameter in the client login page, sanitize it with the shared helper, and call `router.replace(safeNext)` after `saveLocalSession`. Preserve `/dashboard` as the fallback. Do not interpolate arbitrary URLs into navigation.

- [ ] **Step 5: Run the focused gate and login tests.**

  Run:

  ```powershell
  npm test -- --run tests/unit/auth/workspace-auth-gate.test.tsx tests/unit/login.test.tsx
  ```

  Expected: all gate and login assertions pass, including redirect safety.

## Task 2: Add the protected PELP Pal V2 enrollment-code function

**Files:**

- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\issue-enrollment-code\index.ts`
- Create: generated migration under `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\` only if duplicate-username organization scoping cannot be safely handled by the existing function.
- Create or modify: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\tests\enrollment_code_management.sql`

**Interfaces:**

- `POST /functions/v1/issue-enrollment-code` accepts `{ target_username: string }`.
- Success response is `{ code: string; assigned_username: string; expires_at: string }`.
- The function uses existing `_shared/account-auth.ts` helpers: `authenticatedUser`, `activeAccountForUser`, `serviceClient`, `json`, and `corsHeaders`.

- [ ] **Step 1: Inspect current database function and CLI state.**

  From `C:\Users\mklgr\Codes\pelp_pal_v2`, run:

  ```powershell
  supabase --version
  supabase migration list --linked
  rg -n "generate_code|device_enrollment_codes|organization_accounts" supabase/migrations supabase/functions
  ```

  Confirm whether the existing `generate_code(text)` function can be called by the protected server client without resolving a duplicate username to the wrong organization. Do not apply or alter the remote database.

- [ ] **Step 2: Write the failing backend contract tests.**

  Add pgTAP or repository-level contract assertions for:

  ```text
  active Admin authorization is required;
  EPRED, Guest, inactive, revoked, and missing-auth callers are rejected;
  the target username is resolved inside the caller organization;
  missing and inactive targets are rejected without inserting a code;
  duplicate usernames in separate organizations cannot issue a cross-organization code;
  the success payload contains only code, assigned_username, and expires_at;
  no password, hash, service key, or internal account identifier is returned.
  ```

- [ ] **Step 3: Run the backend contract checks and verify the expected failure.**

  Run the repository’s available local Supabase test command for the new contract. If Deno or pgTAP infrastructure is unavailable, record the exact blocked check and continue with static review plus web boundary tests; do not substitute a remote deployment.

- [ ] **Step 4: Implement `issue-enrollment-code/index.ts`.**

  Validate the bearer token with `authenticatedUser`, resolve the caller using `activeAccountForUser`, require `role === 'admin'`, normalize and validate the username with the existing username rules, and resolve the target with `.eq('organization_id', actor.organization_id).eq('username', username).eq('is_active', true)`. Invoke the privileged generator only through `serviceClient().rpc('generate_code', { p_username: username })` if the current database function is organization-safe. If it is not, add a generated server-only organization-scoped overload and call that instead. Return a generic 404 for unavailable targets and a generic 403 for unauthorized callers.

- [ ] **Step 5: Verify the function contract locally.**

  Run:

  ```powershell
  git diff --check
  supabase db lint --linked
  ```

  Expected: no diff errors. Existing unrelated advisor/lint warnings must be recorded separately and not attributed to this function.

## Task 3: Add the typed browser enrollment-code client

**Files:**

- Create: `src/features/enrollment/enrollment-code-client.ts`
- Create: `tests/unit/enrollment/enrollment-code-client.test.ts`

**Interfaces:**

```ts
export type EnrollmentCode = {
  code: string;
  assignedUsername: string;
  expiresAt: string;
};

export type EnrollmentCodeClient = {
  issue(targetUsername: string): Promise<EnrollmentCode>;
};

export function createEnrollmentCodeClient(client?: SupabaseClient<Database>): EnrollmentCodeClient;
```

- [ ] **Step 1: Write failing client tests.**

  Mock `functions.invoke` and assert:

  ```text
  issue(' EPRED.One ') invokes issue-enrollment-code with target_username 'epred.one';
  snake_case assigned_username and expires_at map to camelCase;
  malformed responses reject with a safe incomplete-response error;
  structured function errors surface the backend error without exposing raw credentials;
  the client never invokes rpc('generate_code').
  ```

- [ ] **Step 2: Run the focused client test and verify failure.**

  Run:

  ```powershell
  npm test -- --run tests/unit/enrollment/enrollment-code-client.test.ts
  ```

  Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the typed adapter.**

  Use `getSupabaseBrowserClient().functions.invoke('issue-enrollment-code', { body: { target_username } })`. Validate the response shape, normalize the username before sending, and throw safe actionable errors. Do not persist or log the returned plaintext code.

- [ ] **Step 4: Run the focused client tests.**

  Expected: all adapter tests pass.

## Task 4: Add the admin Account enrollment-code panel

**Files:**

- Create: `src/features/account/enrollment-code-panel.tsx`
- Modify: `src/features/account/account-view.tsx`
- Modify: `tests/unit/account.test.tsx`

**Interfaces:**

- `EnrollmentCodePanel({ currentUsername }: Readonly<{ currentUsername: string | null }>): JSX.Element` receives only display identity; it reads the enrolled device role through the existing AccountView state and invokes the typed enrollment-code client.
- The component keeps `targetUsername`, `code`, `expiresAt`, `saving`, `error`, and `copyState` in component state only.

- [ ] **Step 1: Write failing Account tests.**

  Cover:

  ```text
  an enrolled Admin sees target username, Generate code, and no plaintext code initially;
  a valid mocked response displays the six-digit code and expiration;
  Copy code uses navigator.clipboard.writeText with the generated code;
  clipboard rejection leaves the code visible and shows manual-copy guidance;
  EPRED, Guest, unenrolled, revoked, and inactive states do not render the panel;
  backend errors leave the existing Account screen visible and show an actionable alert.
  ```

- [ ] **Step 2: Run the focused Account tests and verify failure.**

  Run:

  ```powershell
  npm test -- --run tests/unit/account.test.tsx
  ```

  Expected: the new panel assertions fail before the panel is integrated.

- [ ] **Step 3: Implement the responsive panel.**

  Render it only after AccountView has loaded an enrolled active Admin device. Use the existing MUI theme, responsive `Stack`/`Paper`/`TextField`/`Button`/`Alert` primitives, and a monospace code presentation consistent with the central theme. Clear the previous code when a new request begins. Keep the code in React state only, and show an expiration date/time from the server.

- [ ] **Step 4: Implement clipboard behavior.**

  Use `navigator.clipboard.writeText(code)` when available. On rejection or unavailable clipboard support, keep the code visible and show “Copy the code manually” guidance. Do not treat copy failure as code-generation failure.

- [ ] **Step 5: Run Account tests and verify success.**

  Expected: existing Account tests and new panel tests pass.

## Task 5: Add browser-route and enrollment-code E2E coverage

**Files:**

- Create or modify: `tests/e2e/auth-guard.spec.ts`
- Create or modify: `tests/e2e/account-enrollment-code.spec.ts`
- Modify: `playwright.config.ts` only if the existing browser fixture requires a dedicated mocked-auth project.

**Interfaces:**

- Tests must mock the browser Supabase session and `issue-enrollment-code` function boundary; they must not use production credentials or issue real enrollment codes.

- [ ] **Step 1: Add signed-out route tests.**

  Verify direct `/dashboard` and `/lookup` navigation redirects to `/login` with a safe `next` path, while `/enroll` remains accessible.

- [ ] **Step 2: Add signed-in return-path tests.**

  Start at a protected path, complete the mocked login flow, and verify navigation returns to that internal path. Add an external `next` case and verify it falls back to `/dashboard`.

- [ ] **Step 3: Add mocked Admin Account code-generation tests.**

  Verify the Admin panel can generate a code, display expiration, copy the code, and preserve manual-copy guidance when clipboard access is denied.

- [ ] **Step 4: Add mocked non-admin Account tests.**

  Verify EPRED and Guest users do not see the panel or generate-code controls.

- [ ] **Step 5: Run focused browser tests.**

  Run:

  ```powershell
  npm run test:e2e -- tests/e2e/auth-guard.spec.ts tests/e2e/account-enrollment-code.spec.ts
  ```

  Expected: all route-gate, return-path, Admin, non-admin, and public-enrollment assertions pass.

## Task 6: Full verification and staging handoff

- [ ] **Step 1: Run the complete web verification suite.**

  From `C:\Users\mklgr\Codes\pelp-pal-web`, run:

  ```powershell
  npm run typecheck
  npm run lint
  npm test -- --run
  npm run build
  npm run test:e2e
  git diff --check
  ```

  Confirm `.env` and `.env-local` are unchanged and no privileged key appears in the browser bundle or modified web files.

- [ ] **Step 2: Run backend checks without remote writes.**

  From `C:\Users\mklgr\Codes\pelp_pal_v2`, run:

  ```powershell
  supabase db lint --linked
  git diff --check
  ```

  Run local Edge Function checks if Deno is installed. If it is unavailable, report that limitation explicitly.

- [ ] **Step 3: Staging deployment gate.**

  Only after separate deployment approval, apply any migration and deploy `issue-enrollment-code` to the development Supabase project. Verify Admin, EPRED, Guest, inactive, revoked, missing target, inactive target, duplicate username, cross-organization, public enrollment, and protected-route flows.

- [ ] **Step 4: Vercel and production gate.**

  Only after staging verification and explicit approval, configure the required Vercel environment variables, deploy the web build, and verify signed-out redirects and Admin Account code generation against the staging or approved production Supabase project.

- [ ] **Step 5: Commit and push gate.**

  Review the Web and PELP Pal V2 diffs separately. Commit and push only after explicit authorization, keeping the migration/function and Web changes in separate commits.
