# PELP Pal Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate installable Next.js/MUI web client that shares the verified PELP Pal Supabase contract with Flutter, supports offline inspection work, and synchronizes safely after reconnect.

**Architecture:** The browser owns a persisted Supabase anonymous session, IndexedDB mirror, drafts, evidence blobs, sync cursors, and durable outbox. Supabase remains authoritative online; Realtime events trigger pulls, while `pull_sync_changes` provides complete recovery. Pages read local repositories and never write remote tables directly.

**Tech Stack:** Next.js App Router, React, TypeScript, Material UI v7, Supabase browser client, Dexie, Web Crypto, Web Workers, Vitest, Playwright, Vercel.

**Spec:** `C:\Users\mklgr\Codes\pelp-pal-web\plan.md`

## Global Constraints

- Do not create a second Supabase migration history or web-only synchronization protocol.
- Do not expose a service-role or secret key in browser code.
- The verified backend contract at `docs/backend-contract.md` is a prerequisite.
- IndexedDB is authoritative for active browser UI state while offline; remote writes are acknowledged only after server success.
- Realtime events trigger synchronization and never advance cursors directly.
- Guest devices never receive masterlist rows or objects.
- Every authenticated route is non-indexable and has loading, empty, error, retry, and locked states.
- Preserve drafts, evidence, and outbox data during application updates and recoverable failures.

---

### Task 1: Bootstrap the Next.js and MUI shell

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `src/lib/config/env.ts`, `src/lib/supabase/browser.ts`
- Create: `.env.example`, `README.md`

**Interfaces:**
- `env.ts` exports validated `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `browser.ts` exports one browser Supabase client with persisted session storage and automatic refresh.

- [ ] **Step 1: Create the App Router project without Tailwind.** Pin package versions and commit the lockfile.
- [ ] **Step 2: Add an environment parser that throws a named configuration error when either public variable is missing.**
- [ ] **Step 3: Add the MUI App Router integration and render a shell without contacting Supabase.**
- [ ] **Step 4: Add Vitest and Playwright smoke tests.** The shell test must pass with no `.env` file and the browser smoke test must load `/`.
- [ ] **Step 5: Run:**

```powershell
npm run lint
npx tsc --noEmit
npm run test -- --run
npm run build
```

### Task 2: Establish theme, route boundaries, and private-route policy

**Files:**
- Create: `src/theme/tokens.ts`, `src/theme/theme.ts`, `src/theme/app-theme-provider.tsx`
- Create: `src/app/robots.ts`, `src/app/manifest.ts`
- Create: `src/app/loading.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`
- Create: `src/app/(workspace)/layout.tsx`
- Modify: `next.config.ts`

- [ ] **Step 1: Define semantic tokens for color roles, typography, spacing, radii, elevation, focus, and reduced motion.**
- [ ] **Step 2: Use only theme tokens in the shell and shared components.**
- [ ] **Step 3: Add non-indexing metadata and `X-Robots-Tag: noindex, nofollow, noarchive` for authenticated application routes.**
- [ ] **Step 4: Add the workspace boundary as a client bootstrap boundary.** Do not fetch personalized IndexedDB data in Server Components.
- [ ] **Step 5: Add keyboard, responsive, and reduced-motion tests for navigation and shell states.**

### Task 3: Implement the IndexedDB model and repository layer

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/database.ts`, `src/lib/db/records.ts`, `src/lib/db/repository.ts`
- Create: `src/lib/auth/device-identity.ts`
- Create: `tests/unit/db/database-migrations.test.ts`, `tests/unit/db/repository.test.ts`

**Stores:** `device`, `accounts`, `credentials`, `catalog`, `activity`, `inspections`, `inspectionRevisions`, `inspectionDrafts`, `evidence`, `evidenceBlobs`, `conflicts`, `outbox`, `syncState`, `syncCursors`, and `accountResetReceipts`.

**Interfaces:**

```ts
type CursorState = {
  revision: number;
  activity: number;
  conflict: number;
  deletion: number;
};

type OutboxItem = {
  id: string;
  kind: 'inspection' | 'activity' | 'evidence' | 'delete' | 'reset-receipt';
  aggregateId: string;
  status: 'pending' | 'uploading' | 'pushing' | 'retry' | 'conflict' | 'failed';
  attemptCount: number;
  nextAttemptAt: string;
  payload: unknown;
  lastError?: { code: string; message: string };
};
```

- [ ] **Step 1: Define versioned Dexie tables and indexes for lookup, cursor, retry, and inspection ownership queries.**
- [ ] **Step 2: Generate one UUID installation ID per browser profile and persist it before enrollment.**
- [ ] **Step 3: Implement repository transactions that apply remote rows and advance the corresponding cursor in one transaction.**
- [ ] **Step 4: Store evidence metadata separately from `Blob` values.** Request persistent storage where supported and surface quota failures.
- [ ] **Step 5: Add migration tests, reload tests, and a test proving a cursor is unchanged when row application fails.**

### Task 4: Implement enrollment, local authentication, and account/reset state

**Files:**
- Create: `src/features/enrollment/*`, `src/features/auth/*`, `src/features/account/*`
- Create: `src/lib/auth/local-auth.ts`, `src/lib/auth/session-bootstrap.ts`
- Create: `src/app/enroll/page.tsx`, `src/app/login/page.tsx`
- Create: `tests/unit/auth/argon2-compatibility.test.ts`, `tests/integration/enrollment.test.ts`

- [ ] **Step 1: Restore or create the anonymous Supabase session before calling `enroll-device`.**
- [ ] **Step 2: Send `installation_id`, `platform: "web"`, and the actual application version.** Persist enrollment only after a successful response.
- [ ] **Step 3: Implement the Flutter Argon2id parser and verifier using the shared fixtures.** Run derivation in a Worker so the login UI remains responsive.
- [ ] **Step 4: Permit offline login only when a prior credential sync exists and the local account is active.**
- [ ] **Step 5: Apply reset commands in one local transaction with a unique receipt, then invoke `consume_account_reset`.** A repeated command must not modify the account twice.
- [ ] **Step 6: Add active-session locking for inactive accounts and revoked devices.** Reopening the page must not bypass the lock.

### Task 5: Implement sync cursors, outbox delivery, and reconciliation

**Files:**
- Create: `src/lib/sync/coordinator.ts`, `src/lib/sync/outbox.ts`, `src/lib/sync/reconciliation.ts`
- Create: `src/features/sync/*`, `src/app/(workspace)/sync/page.tsx`
- Create: `tests/unit/sync/outbox.test.ts`, `tests/unit/sync/reconciliation.test.ts`, `tests/integration/offline-recovery.test.ts`

**Interfaces:**

```ts
type PullResult = {
  revisions: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  deletions: Array<Record<string, unknown>>;
};

interface SyncCoordinator {
  syncNow(reason: 'startup' | 'resume' | 'online' | 'realtime' | 'manual' | 'retry'): Promise<void>;
  getStatus(): SyncStatus;
}
```

- [ ] **Step 1: Implement a single-flight sync coordinator.** A second trigger joins the active promise instead of starting a parallel cycle.
- [ ] **Step 2: Pull authorized accounts and cursor pages, apply them transactionally, and continue until an empty page is returned.** Reject non-empty pages that advance no cursor.
- [ ] **Step 3: Drain outbox items in dependency order: local blob, evidence upload, revision/activity RPC, acknowledgment, local status update.**
- [ ] **Step 4: Keep items after network, Storage, or RPC failures.** Use bounded exponential backoff and preserve the last useful error.
- [ ] **Step 5: Keep conflicts terminal until the user resolves them through the conflict RPC.** Never convert a conflict into last-write-wins.
- [ ] **Step 6: Add Web Locks and a safe fallback lease so two tabs do not drain the same item concurrently.**
- [ ] **Step 7: Add tests for crash points before upload, after upload, before RPC acknowledgment, after acknowledgment, and during cursor application.**

### Task 6: Add centralized Realtime subscriptions

**Files:**
- Create: `src/lib/realtime/coordinator.ts`, `src/lib/realtime/subscriptions.ts`, `src/lib/realtime/event-router.ts`
- Modify: `src/lib/sync/coordinator.ts`
- Create: `tests/integration/realtime-gap-recovery.test.ts`

- [ ] **Step 1: Create one channel coordinator for authorized tables.** Pages must not create independent subscriptions.
- [ ] **Step 2: Route every event to `syncNow('realtime')`; do not mutate repositories from raw events.**
- [ ] **Step 3: Reconcile after channel error, token refresh, tab resume, and browser online events.**
- [ ] **Step 4: Stop subscriptions immediately when enrollment or revocation state becomes invalid.**
- [ ] **Step 5: Verify Web→Web Realtime and WebSocket-gap recovery against the backend publication and RLS tests.**

### Task 7: Build catalog, workspace, dashboard, and lookup

**Files:**
- Create: `src/components/app-shell/*`, `src/components/product/*`, `src/features/dashboard/*`, `src/features/catalog/*`
- Create: `src/app/(workspace)/dashboard/page.tsx`, `src/app/(workspace)/lookup/page.tsx`

- [ ] **Step 1: Build responsive Drawer/AppBar and mobile navigation using the shared theme.**
- [ ] **Step 2: Render dashboard metrics from the local mirror and update them after repository notifications.**
- [ ] **Step 3: Implement lookup by control number, model, brand, and product type using local indexes.**
- [ ] **Step 4: Enforce catalog scope before writing or displaying catalog rows.** Add a test proving a guest never receives masterlist data.
- [ ] **Step 5: Add manual control-number entry.** Treat QR scanning as an optional enhancement with a manual fallback.

### Task 8: Build inspection drafts, validation, evidence, and conflicts

**Files:**
- Create: `src/features/inspection/*`, `src/components/inspection/*`
- Create: `src/lib/evidence/jpeg.ts`, `src/lib/evidence/hash.ts`, `src/lib/evidence/validation.ts`
- Create: `src/app/inspect/[inspectionId]/page.tsx`
- Create: `tests/unit/inspection/validator-parity.test.ts`, `tests/unit/evidence/evidence-validation.test.ts`, `tests/e2e/inspection-flow.spec.ts`

- [ ] **Step 1: Port the Flutter inspection fields, enum values, conditional validation, comparison rules, and maximum-three-photo rule from the shared fixtures.**
- [ ] **Step 2: Autosave every mutable field and current step to `inspectionDrafts`; restore it after reload.**
- [ ] **Step 3: Normalize selected images to JPEG, calculate SHA-256, enforce the 5 MiB limit, validate JPEG magic bytes, and save the Blob before enqueueing upload work.**
- [ ] **Step 4: Use `{organization_id}/{inspection_id}/{evidence_id}.jpg` and stable evidence metadata identifiers.**
- [ ] **Step 5: Upload required evidence before pushing the revision.** Preserve the outbox item when upload or RPC fails.
- [ ] **Step 6: Show `Saving`, `Saved locally`, `Uploading`, `Synced`, and `Sync failed` states without hiding unsynced data.**
- [ ] **Step 7: Add explicit conflict review and authorized resolution through `resolve_inspection_conflict`.**

### Task 9: Add activity, summary, transfers, PWA lifecycle, and security headers

**Files:**
- Create: `src/features/activity/*`, `src/features/summary/*`, `src/features/transfer/*`
- Create: `src/lib/import-export/*`, `src/app/(workspace)/activity/page.tsx`, `src/app/(workspace)/summary/page.tsx`, `src/app/(workspace)/account/page.tsx`
- Create: `public/sw.js`, `src/lib/pwa/register-service-worker.ts`, `vercel.json`
- Modify: `src/app/manifest.ts`, `next.config.ts`

- [ ] **Step 1: Build activity and summary views from repositories, not direct remote queries.**
- [ ] **Step 2: Implement `.PELP` and Excel transfer semantics from Flutter fixtures using browser file input and downloads.**
- [ ] **Step 3: Cache only static application assets in the service worker.** Never cache Supabase Auth, REST, Storage, or Realtime responses.
- [ ] **Step 4: Preserve IndexedDB across service-worker updates and prompt before destructive reload when drafts or outbox items exist.**
- [ ] **Step 5: Add CSP and security headers that permit only the configured Supabase URL, Storage URL, and Realtime WebSocket origin.**

### Task 10: Run the full acceptance matrix and CI gates

**Files:**
- Create: `tests/e2e/cross-client/*.spec.ts`, `tests/e2e/security/*.spec.ts`
- Create: `.github/workflows/web-ci.yml`
- Modify: `README.md`, `docs/backend-contract.md`

- [ ] **Step 1: Seed disposable test organizations with admin, EPRED, guest, same-organization, different-organization, revoked, and unenrolled devices.**
- [ ] **Step 2: Verify Web→Web Realtime, Flutter→Web cursor sync, Web→Flutter normal sync, offline recovery, Realtime-gap recovery, conflict resolution, account reset, revocation, and organization isolation.**
- [ ] **Step 3: Assert no duplicate revision, activity event, evidence metadata row, reset application, or tombstone application after retries.**
- [ ] **Step 4: Run:**

```powershell
npm run lint
npx tsc --noEmit
npm run test
npm run test:integration
npm run test:e2e
npm run build
git diff --check
```

- [ ] **Step 5: Verify response headers, route noindex behavior, keyboard paths, responsive layouts, service-worker cache contents, dependency audit, and secret scanning.**
- [ ] **Step 6: Record deployment-only checks separately.** Do not call the application production-ready until the hosted Supabase, Realtime, Storage, Vercel, and cross-client tests pass.

**Verification gate:** The web plan is complete only when every acceptance test passes against the verified backend contract, Flutter remains operational, no privileged credential reaches the browser, and pending local data survives reload and reconnect.
