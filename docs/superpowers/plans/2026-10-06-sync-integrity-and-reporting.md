# PELP Pal Sync Integrity and Reporting Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inspections uniquely addressable, synchronize evidence and conflicts safely, recover interrupted outbox work, and ensure consolidated reports include all finished records.

**Architecture:** Keep Supabase authoritative online and IndexedDB authoritative for the active browser. Add unique local inspection identities, explicit remote push results, evidence metadata plus Storage transfer, durable outbox recovery, and paginated report reads without changing the existing Flutter/Supabase sync protocol.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI, Supabase JS, Supabase SQL migrations, Dexie, Vitest, Playwright.

**Spec:** `docs/superpowers/plans/2026-10-01-pelp-pal-web.md` and the existing Flutter/Supabase migrations under `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations`.

## Global Constraints

- Preserve the Flutter/Supabase sync contract; do not create a web-only synchronization protocol.
- Never expose service-role or secret keys in browser code.
- Preserve drafts, evidence, conflicts, and outbox records across reloads and recoverable failures.
- Treat a server conflict as a conflict, never as a successful upload.
- Do not silently truncate official summaries or Annex A exports.
- Every task must add or update focused tests before implementation changes.

---

### Task 1: Separate product identity from inspection identity

**Files:**
- Modify: `src/app/(workspace)/lookup/lookup-view.tsx`
- Modify: `src/app/inspect/[inspectionId]/page.tsx`
- Modify: `src/features/inspection/inspection-editor.tsx`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/records.ts`
- Test: `tests/unit/lookup.test.tsx`, `tests/unit/inspection/editor.test.tsx`, `tests/unit/db/repository.test.ts`

- [ ] Add a failing test proving two inspections of the same catalog row create two local inspection IDs and remain separately editable.
- [ ] Generate a UUID for a new inspection while retaining the catalog ID/control number as product reference data.
- [ ] Load existing inspection records by inspection ID and keep edit routes backward-compatible for existing records.
- [ ] Update duplicate detection to use store, control number, model, and inspector without treating a new inspection UUID as the product identity.
- [ ] Run the focused lookup, editor, and repository tests.

### Task 2: Synchronize evidence and handle push results

**Files:**
- Modify: `src/lib/db/records.ts`, `src/lib/db/repository.ts`
- Modify: `src/lib/supabase/remote-source.ts`
- Modify: `src/features/inspection/inspection-editor.tsx`
- Modify: `src/lib/sync/coordinator.ts`
- Modify: `supabase/migrations/<new evidence sync migration>.sql`
- Test: `tests/unit/sync/remote-source.test.ts`, `tests/unit/db/repository.test.ts`, `tests/unit/inspection/editor.test.tsx`

- [ ] Add failing tests for evidence metadata in the revision payload, successful evidence upload, remote-path persistence, and a returned conflict status.
- [ ] Upload optimized JPEG evidence to the authorized Storage path before pushing the revision, then include stable evidence metadata in `payload.evidence`.
- [ ] Remove local evidence only after the remote revision and Storage upload are acknowledged.
- [ ] Parse the RPC response and convert `{ status: 'conflict' }` into a durable local conflict/outbox state.
- [ ] Add the corresponding Supabase migration only after matching the existing Flutter migration contract and security policies.
- [ ] Run local SQL tests or staging RPC verification before calling this phase complete.

### Task 3: Harden outbox, cursor, Realtime, and conflict workflows

**Files:**
- Modify: `src/lib/sync/coordinator.ts`, `src/lib/db/repository.ts`
- Modify: `src/lib/realtime/event-router.ts`
- Modify: `src/features/sync/sync-view.tsx`
- Create/modify: `src/features/sync/conflict-resolution-panel.tsx`
- Test: `tests/unit/sync/coordinator.test.ts`, `tests/unit/sync/remote-source.test.ts`, `tests/unit/sync/sync-view.test.tsx`

- [ ] Add failing tests for stale `pushing` recovery, automatic retry scheduling, poison-item isolation, non-progressing pull pages, queued full-sync requests, and repeated updates to the same database row.
- [ ] Recover stale pushing records, schedule due retries, preserve the strongest queued operation, and reject non-progressing cursors.
- [ ] Deduplicate Realtime events by event identity/cursor rather than record ID.
- [ ] Add explicit conflict list, local/remote preview, resolution action, and resolution status.
- [ ] Run all sync unit tests and a two-client staging test.

### Task 4: Enforce complete inspections and complete catalogs

**Files:**
- Modify: `src/features/inspection/inspection-editor.tsx`
- Modify: `src/features/catalog/catalog-sync.ts`
- Modify: `src/features/sync/sync-view.tsx`
- Test: `tests/unit/inspection/editor.test.tsx`, `tests/unit/catalog-sync.test.ts`, `tests/unit/sync/sync-view.test.tsx`

- [ ] Add a failing test that prevents completion when any required checklist field is missing.
- [ ] Use the existing draft validator on final completion and preserve the draft on validation failure.
- [ ] Add guest-catalog synchronization for enrolled guest devices without exposing masterlist rows.
- [ ] Show catalog scope, version, integrity status, and last successful catalog synchronization in Sync.
- [ ] Run focused tests and responsive browser checks.

### Task 5: Remove report truncation and add export safety

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/features/summary/summary-view.tsx`, `src/features/report/report-view.tsx`
- Modify: `src/features/report/docx-template.ts`
- Test: `tests/unit/summary.test.tsx`, `tests/unit/summary-export.test.ts`, `tests/unit/report.test.ts`

- [ ] Add failing tests for more than 500 inspections and more Annex A rows than the source template contains.
- [ ] Page or stream completed inspection reads until all records are loaded for exports.
- [ ] Dynamically append Annex A rows when required and preserve the template header/footer formatting.
- [ ] Show export counts and warn only when a source field is genuinely unavailable.
- [ ] Render and inspect a DOCX/PDF sample with 500+ records before completion.

### Task 6: QoL, observability, and release verification

**Files:**
- Modify: `src/features/sync/sync-view.tsx`, `src/features/activity/activity-view.tsx`
- Modify: `src/app/(workspace)/loading.tsx`, route error states, and relevant tests
- Create: `tests/integration/sync-staging.test.ts` only if a safe isolated staging harness is available

- [ ] Add per-operation status, last upload/download/catalog times, retry-one-item, and export diagnostics controls.
- [ ] Add unsynced evidence indicators, storage usage/cleanup guidance, and clear offline/online status copy.
- [ ] Add loading, empty, error, retry, keyboard, responsive, reduced-motion, and accessibility coverage for new states.
- [ ] Run typecheck, lint, all unit tests, integration/staging checks, build, E2E, dependency audit, and response-header review.
- [ ] Record any live Supabase, Storage, camera, Safari, and Vercel checks that remain before deployment.
