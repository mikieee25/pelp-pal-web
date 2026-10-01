# PELP Pal Web — Online-First Realtime Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking. Inspect the current Flutter implementation and Supabase contract before reproducing shared behavior.

## Goal

Build a separate, installable **PELP Pal Web** application using Next.js and Material UI that preserves the existing inspector workflow while providing:

- full online operation;
- near-realtime synchronization of inspections, accounts, activity, conflicts, device state, catalog updates, evidence metadata, and deletions;
- compatibility with the existing Flutter PELP Pal application;
- offline inspection capability during temporary connectivity loss; and
- automatic synchronization after reconnect.

The existing Supabase project remains the authoritative shared backend.

---

## Core Architecture

```text
Supabase = authoritative shared backend
Supabase Realtime = immediate update notification
pull_sync_changes = durable catch-up/recovery
IndexedDB = offline cache + drafts + outbox
Flutter + Web = same inspection/revision/conflict/evidence protocol
```

The existing Flutter application remains at:

```text
C:\Users\mklgr\Codes\pelp_pal_v2
```

Create the web application as a sibling project:

```text
C:\Users\mklgr\Codes\pelp_pal_web
```

Do not embed Next.js inside the Flutter project.

Do not create a separate web database or web-only sync protocol.

Supabase migrations remain owned by the existing backend/mobile repository.

---

## Locked Decisions

- Use **Next.js App Router**, React, TypeScript, and **Material UI v7**.
- Do not use Tailwind.
- Deploy the web application on Vercel.
- Use the existing Supabase project.
- A browser profile is its own enrolled device with a unique Supabase anonymous Auth session and persistent `installation_id`.
- Supabase is authoritative when online.
- IndexedDB is the local cache, draft store, evidence store, sync cursor store, and durable outbox.
- Online changes push immediately; users should not normally need to press **Sync**.
- Supabase Realtime provides immediacy, but cursor-based synchronization remains required for recovery.
- The existing Flutter revision/conflict model must remain compatible.
- Evidence stays in the existing private `inspection-evidence` bucket.
- All application routes remain `noindex`.
- Never expose a Supabase secret/service-role key to the browser.

---

## Existing Supabase Contract

Relevant existing entities include:

```text
devices
device_enrollment_codes
organization_accounts
catalog_manifests
inspections
inspection_revisions
inspection_conflicts
inspection_evidence
inspection_deletion_tombstones
activity_events
account_reset_commands
```

Relevant existing RPCs include:

```text
enroll_device
pull_sync_changes
push_inspection_revisions
push_activity_events
resolve_inspection_conflict
consume_account_reset
```

Relevant Edge Functions include:

```text
enroll-device
issue-account-reset
cleanup-inspections
```

### Important corrections

There is currently **no**:

```text
delete_inspection_sync
```

RPC. Do not implement a wrapper for it.

Deletion/cleanup currently uses the privileged cleanup flow plus:

```text
inspection_deletion_tombstones
```

`organization_accounts` contains account metadata such as username, display name, role, active state, and update timestamp. It does **not** contain the normal local password hash.

Credential/reset handling must therefore follow the existing Flutter and `account_reset_commands` behavior.

The existing evidence bucket is:

```text
inspection-evidence
```

with:

```text
private access
image/jpeg only
5 MiB maximum object size
```

---

## Realtime and Sync Contract

The web application shall maintain live awareness of:

```text
devices
organization_accounts
account_reset_commands
catalog_manifests
inspections
inspection_revisions
activity_events
inspection_conflicts
inspection_evidence
inspection_deletion_tombstones
```

Required tables must be added to the existing:

```text
supabase_realtime
```

publication through a normal Supabase migration.

Realtime must always respect existing RLS and organization isolation.

### Normal online write

```text
save locally
→ create outbox entry
→ upload required evidence
→ push revision/activity through existing backend contract
→ receive server acknowledgement
→ mark outbox item synced
→ other connected clients receive Realtime update
```

### Offline write

```text
save draft/evidence locally
→ complete locally if validation passes
→ queue in outbox
→ reconnect
→ upload evidence
→ push revision/activity
→ reconcile remote changes
```

### Reconnect

```text
restore Auth session
→ verify enrolled device
→ refresh account state
→ pull missed changes using cursors
→ apply resets/tombstones/conflicts
→ drain local outbox
→ pull again
→ refresh catalog if needed
→ restore Realtime state
```

Realtime is never treated as the sole source of synchronization truth.

---

## Target Structure

```text
pelp_pal_web/
  src/
    app/
      (workspace)/
        dashboard/
        lookup/
        activity/
        summary/
        sync/
        account/
      enroll/
      inspect/[inspectionId]/
      login/
      layout.tsx
      page.tsx
      manifest.ts
      robots.ts

    components/
      app-shell/
      feedback/
      inspection/
      product/
      sync/
      ui/

    features/
      account/
      activity/
      auth/
      catalog/
      dashboard/
      enrollment/
      inspection/
      realtime/
      summary/
      sync/
      transfer/

    lib/
      auth/
      config/
      db/
      evidence/
      import-export/
      realtime/
      supabase/
      sync/

    theme/
      tokens.ts
      theme.ts
      app-theme-provider.tsx

  public/
    icons/
    sw.js

  tests/
    unit/
    integration/
    e2e/
```

---

# Task 1: Verify and Harden the Shared Backend Contract

## Work

- [ ] Inspect the current Flutter sync, auth, inspection, evidence, and account-reset implementations.
- [ ] Record current RPC signatures, Edge Functions, RLS policies, Storage rules, and relevant tables.
- [ ] Confirm the current Flutter Argon2id credential format and generate compatibility test vectors.
- [ ] Add required tables to `supabase_realtime`.
- [ ] Ensure revoked devices are rejected by backend authorization, not only by frontend checks.
- [ ] Review existing `SECURITY DEFINER` functions and explicit `EXECUTE` privileges.
- [ ] Set safe explicit `search_path` values where required.
- [ ] Preserve Flutter compatibility.
- [ ] Run Supabase security advisors after backend changes.
- [ ] Document the verified contract in `docs/backend-contract.md`.

Do not create a second migration history inside the web repository.

---

# Task 2: Bootstrap Next.js, MUI, and Supabase

## Create

```text
src/app/layout.tsx
src/app/page.tsx
src/app/globals.css
src/theme/tokens.ts
src/theme/theme.ts
src/theme/app-theme-provider.tsx
src/lib/config/env.ts
src/lib/supabase/browser.ts
src/lib/supabase/database.types.ts
src/lib/supabase/remote-source.ts
.env.example
README.md
```

## Work

- [ ] Create a Next.js App Router TypeScript project without Tailwind.
- [ ] Install and pin MUI v7, Emotion, Supabase JS, Dexie, `hash-wasm`, Vitest, and Playwright.
- [ ] Use the version-compatible MUI App Router integration.
- [ ] Build semantic DOE theme tokens.
- [ ] Use MUI theme tokens instead of scattered CSS literals.
- [ ] Configure `metadata`, viewport, `robots.ts`, reduced-motion defaults, and universal `noindex`.
- [ ] Generate TypeScript database types from the existing Supabase project.
- [ ] Configure only:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

- [ ] Never expose a secret/service-role key.
- [ ] Create one persisted Supabase browser client with automatic session refresh.
- [ ] Add typed wrappers only for APIs that actually exist.
- [ ] Verify the application shell renders without requiring Supabase.

---

# Task 3: Build IndexedDB Storage, Device Identity, and Durable Outbox

## Create

```text
src/lib/db/database.ts
src/lib/db/schema.ts
src/lib/db/records.ts
src/lib/db/repository.ts
src/lib/auth/device-identity.ts
```

## Stores

Include:

```text
device
accounts
credentials
catalog
activity
inspections
inspectionRevisions
inspectionDrafts
evidence
evidenceBlobs
conflicts
outbox
syncState
syncCursors
accountResetReceipts
```

## Work

- [ ] Create one persistent `installationId` per browser profile.
- [ ] Treat cleared browser storage as a new device requiring enrollment.
- [ ] Store drafts, evidence, outbox entries, and sync cursors transactionally.
- [ ] Advance cursors only after received data is durably applied.
- [ ] Store evidence blobs separately from frequently queried metadata.
- [ ] Encrypt sensitive local credential/session-wrapper data with Web Crypto where practical.
- [ ] Never claim IndexedDB has SQLCipher-equivalent protection.
- [ ] Add schema migration tests and rollback tests.
- [ ] Prevent multiple tabs from draining the same outbox simultaneously using Web Locks where available.

---

# Task 4: Implement Enrollment, Local Login, and Account Sync

## Create

```text
src/features/enrollment/*
src/features/auth/*
src/features/account/*
src/lib/auth/local-auth.ts
src/app/enroll/page.tsx
src/app/login/page.tsx
```

## Work

- [ ] Create or restore the browser anonymous Supabase Auth session.
- [ ] Enroll through the existing `enroll-device` function.
- [ ] Send:

```text
installation_id
platform: "web"
app_version
```

- [ ] Persist enrollment state only after successful enrollment.
- [ ] Sync authorized account metadata.
- [ ] Reproduce Flutter-compatible local password verification.
- [ ] Use shared Flutter/web Argon2id test vectors.
- [ ] Never store plaintext passwords.
- [ ] Permit offline login only after a previous successful credential sync.
- [ ] Refresh account state when online.
- [ ] Lock the active local session if the account becomes inactive.
- [ ] Detect device revocation and require re-enrollment.
- [ ] Apply `account_reset_commands` atomically and invoke `consume_account_reset`.
- [ ] Prevent reset commands from being applied twice.

---

# Task 5: Implement Realtime and Durable Synchronization

## Create

```text
src/lib/realtime/coordinator.ts
src/lib/realtime/subscriptions.ts
src/lib/realtime/event-router.ts
src/lib/sync/coordinator.ts
src/lib/sync/outbox.ts
src/lib/sync/reconciliation.ts
src/features/sync/*
```

## Work

- [ ] Centralize Realtime subscriptions; individual pages must not create independent channels.
- [ ] Subscribe to authorized device, account, inspection, activity, conflict, evidence, catalog, reset, and tombstone changes.
- [ ] Route events through repositories instead of directly mutating page state.
- [ ] Deduplicate events using stable IDs/change cursors.
- [ ] Reconcile using `pull_sync_changes` after reconnect or channel failure.
- [ ] Maintain revision, activity, conflict, and deletion cursors.
- [ ] Serialize sync cycles.
- [ ] Push online outbox entries immediately.
- [ ] Automatically retry queued offline work after reconnect.
- [ ] Preserve retryable outbox items after network, Storage, or RPC failures.
- [ ] Never clear an outbox item until the corresponding remote operation is acknowledged.
- [ ] Keep a manual **Sync now** action for recovery.
- [ ] Expose meaningful states:

```text
Live
Syncing
Pending
Reconnecting
Offline
Error
```

---

# Task 6: Build Workspace, Dashboard, Catalog Lookup, and Inspector

## Create

```text
src/components/app-shell/*
src/features/dashboard/*
src/features/catalog/*
src/features/inspection/*
src/components/inspection/*
src/app/(workspace)/layout.tsx
src/app/(workspace)/dashboard/page.tsx
src/app/(workspace)/lookup/page.tsx
src/app/inspect/[inspectionId]/page.tsx
```

## Work

- [ ] Build desktop Drawer/AppBar navigation.
- [ ] Build mobile BottomNavigation/temporary drawer navigation.
- [ ] Show live connection/sync state and pending count.
- [ ] Build dashboard from the synchronized local mirror.
- [ ] Update dashboard automatically from Realtime events.
- [ ] Implement local catalog lookup by control number, model, brand, and product type.
- [ ] Add manual control-number entry.
- [ ] Add QR scanning as progressive enhancement.
- [ ] Never scrape the public PELP Portal.
- [ ] Port current Flutter inspection validation rules.
- [ ] Build MUI stepper workflow.
- [ ] Autosave every mutable field locally.
- [ ] Preserve draft state after reload.
- [ ] Show:

```text
Saving
Saved locally
Uploading
Synced
Sync failed
```

- [ ] Permit supported inspection work while offline.

---

# Task 7: Implement Evidence and Conflict Handling

## Work

- [ ] Normalize camera/gallery input to JPEG.
- [ ] Respect the existing 5 MiB object limit.
- [ ] Calculate SHA-256.
- [ ] Preserve stable evidence UUID and display order.
- [ ] Save the local blob before remote upload.
- [ ] Upload using:

```text
{organization_id}/{inspection_id}/{evidence_id}.jpg
```

- [ ] Push the inspection revision only after required evidence uploads succeed.
- [ ] Keep failed uploads retryable.
- [ ] Sync evidence metadata without downloading every image.
- [ ] Download private evidence only when opened/restored/exported.
- [ ] Validate downloaded MIME/magic bytes, size, and SHA-256 before caching.
- [ ] Preserve the existing optimistic revision/conflict model.
- [ ] Never silently use last-write-wins for competing inspection edits.
- [ ] Use `resolve_inspection_conflict` for authorized resolution.
- [ ] Propagate resolved revisions to other clients through the shared backend.

---

# Task 8: Add Activity, Summary, Transfers, PWA, and Deployment

## Create

```text
src/features/activity/*
src/features/summary/*
src/features/transfer/*
src/lib/import-export/*
src/app/(workspace)/activity/page.tsx
src/app/(workspace)/summary/page.tsx
src/app/(workspace)/sync/page.tsx
src/app/(workspace)/account/page.tsx
src/app/manifest.ts
public/sw.js
vercel.json
.github/workflows/web-ci.yml
docs/operations/pelp-pal-web.md
```

## Work

- [ ] Build live activity view.
- [ ] Build compliance summary from synchronized records.
- [ ] Update summary/activity automatically when remote changes arrive.
- [ ] Implement current `.PELP` and Excel transfer semantics where applicable.
- [ ] Use browser file inputs/downloads rather than arbitrary filesystem access.
- [ ] Add installable manifest and icons.
- [ ] Cache only static application assets in the service worker.
- [ ] Never service-worker-cache authenticated Supabase responses.
- [ ] Preserve IndexedDB during application updates.
- [ ] Prompt before destructive reload when drafts/outbox items exist.
- [ ] Add appropriate security headers/CSP.
- [ ] Configure Vercel with public Supabase configuration only.
- [ ] Add CI gates for lint, typecheck, unit tests, integration tests, e2e tests, build, dependency audit, and secret scan.

---

# Critical Acceptance Tests

## 1. Web → Web Realtime

```text
Browser A completes inspection
→ Browser B receives it automatically
```

Verify:

- inspection appears without refresh;
- activity updates;
- dashboard/summary update;
- no duplicate revision appears.

## 2. Flutter → Web

```text
Flutter syncs inspection
→ Web receives it automatically
```

Verify inspection, activity, revision head, and evidence metadata compatibility.

## 3. Web → Flutter

```text
Web creates inspection
→ Flutter normal sync retrieves it
```

Verify existing Flutter sync remains compatible.

## 4. Offline Recovery

```text
disconnect
→ create inspection + evidence
→ reload
→ reconnect
```

Verify draft, evidence, outbox, automatic upload, revision push, and remote propagation survive.

## 5. Realtime Gap Recovery

```text
WebSocket disconnects
→ remote changes occur
→ reconnect
```

Verify `pull_sync_changes` catches all missed records without duplicates.

## 6. Concurrent Conflict

```text
Device A edits revision N
Device B edits revision N
```

Verify one valid head, one explicit conflict, and successful authorized resolution.

## 7. Account and Reset Sync

Verify:

- account activation/role changes propagate;
- inactive active-user session is locked;
- reset command updates local credential material;
- old credential stops working;
- reset is consumed once.

## 8. Device Revocation

Verify:

- connected browser detects revocation;
- workspace locks;
- subscriptions stop;
- backend rejects subsequent writes;
- reload does not bypass revocation.

## 9. Organization Isolation

Test:

```text
admin
EPRED
guest
same-organization second device
different organization
revoked device
unenrolled device
```

Verify RLS prevents unauthorized account, inspection, catalog, conflict, and evidence access.

---

# Completion Criteria

The web application is complete when:

- [ ] it is a separate Next.js/MUI project;
- [ ] Flutter remains operational;
- [ ] both clients use the same Supabase backend;
- [ ] Supabase is authoritative online;
- [ ] Realtime updates connected clients automatically;
- [ ] cursor synchronization recovers missed events;
- [ ] IndexedDB safely preserves drafts, evidence, cache, and outbox data;
- [ ] offline inspections synchronize automatically after reconnect;
- [ ] Flutter-created inspections appear on web;
- [ ] web-created inspections synchronize to Flutter;
- [ ] account/reset/device changes propagate correctly;
- [ ] conflicts remain explicit and resolvable;
- [ ] private evidence remains private;
- [ ] tombstones remove deleted local inspection data;
- [ ] guest devices never receive masterlist content;
- [ ] no privileged Supabase key reaches browser code;
- [ ] authenticated Supabase responses are not service-worker cached;
- [ ] all application routes remain non-indexable;
- [ ] security, Realtime, offline/reconnect, and cross-client tests pass.

---

# Verification Commands

```powershell
cd C:\Users\mklgr\Codes\pelp_pal_web

npm run lint
npx tsc --noEmit
npm run test
npm run test:integration
npm run test:e2e
npm run build
git diff --check
```

For shared Supabase changes, also run the supported Supabase advisor and migration verification workflow from the existing backend repository.

---

# Final Architectural Rules

1. **Supabase is authoritative; IndexedDB is the local cache/outbox.**
2. **Realtime provides immediacy; cursor sync provides completeness.**
3. **Flutter and Web share the same inspection/revision/conflict/evidence protocol.**
4. **Do not create web-only backend tables or a second synchronization protocol.**
5. **Do not bypass existing inspection conflict handling with direct writes.**
6. **Do not expose privileged Supabase credentials to the browser.**
7. **Do not silently discard offline work or silently resolve concurrent edits.**
8. **Do not declare the project production-ready until Web↔Web, Flutter↔Web, offline/reconnect, authorization, reset, and revocation tests pass.**
