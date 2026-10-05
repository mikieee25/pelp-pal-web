# PELP Pal Web Sync and EMV Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing local-first synchronization coordinator to the authenticated workspace and add a Report tab that edits local EMV report details and downloads a populated copy of the supplied Word template.

**Architecture:** Bootstrap one shared `SyncCoordinator` at the workspace boundary using the existing `SupabaseSyncRemote`, local repository, and Realtime coordinator. Keep IndexedDB as the offline source for screens and report drafts; synchronize raw inspection revisions/events and recalculate reports locally. Build the Report tab as a client feature that consolidates local inspections, stores per-finished-store header details, and patches a retained DOCX template in the browser without changing the source template.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI v7, Supabase JS, Dexie, Realtime, Vitest, Playwright, `jszip@3.10.1` for browser-side DOCX package edits, and the supplied `public/EMV Report Sample.docx` template.

**Spec:** `docs/superpowers/specs/2026-10-05-pelp-pal-sync-report.md`

## Global Constraints

- Supabase remains authoritative online; IndexedDB remains authoritative for active browser UI state while offline.
- Do not create a second Supabase migration history or web-only synchronization protocol.
- Do not expose a service-role or secret key in browser code.
- Realtime events trigger cursor pulls and never advance cursors directly.
- Aggregate Summary and Report totals are calculated locally from synchronized inspection records; aggregate counters are not synchronized.
- Report header drafts are local until the backend contract defines an authorized report entity and RPC.
- Keep `public/EMV Report Sample.docx` byte-for-byte unchanged; generated downloads are separate files.
- Report export must preserve the template’s page geometry, styles, notices, signature sections, and untouched package relationships.
- Report tables render zero-filled rows and show `N/A` for zero-denominator rates.
- Run focused tests after each task and the full lint/typecheck/test/build gate before claiming completion.

## Review Focus

- A second sync trigger must join the active sync promise instead of pushing or pulling concurrently; test the single-flight promise and cursor behavior in Task 1.
- A failed push must preserve the outbox item and its retry metadata; test failure retention in Task 2.
- A repeated product inspection must consolidate by store and control number while preserving NC priority; test duplicate and multi-inspector cases in Task 4.
- A report with no inspections must still show every fixed ECP row and safe percentage text; test zero-state rendering in Task 5.
- A DOCX export must not damage the retained template when text contains XML-sensitive characters or long NC descriptions; test escaping and package preservation in Task 6.

---

### Task 1: Create the shared sync runtime and status store

**Files:**
- Create: `src/lib/sync/runtime.ts`
- Create: `src/features/sync/sync-status-store.ts`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/lib/sync/coordinator.ts`
- Test: `tests/unit/sync/runtime.test.ts`, `tests/unit/sync/coordinator.test.ts`

**Interfaces:**
- `getSyncRuntime(): SyncRuntime | undefined`
- `SyncRuntime = { coordinator: SyncCoordinator; stop: () => void }`
- `SyncStatusSnapshot = { status: SyncStatus; lastSyncedAt?: string; pendingCount: number; conflictCount: number; lastError?: string }`
- `SyncStatusStore.subscribe(listener: () => void): () => void`
- `SyncStatusStore.getSnapshot(): SyncStatusSnapshot`
- `SyncStatusStore.syncNow(reason: SyncReason): Promise<void>`

- [ ] **Step 1: Write failing tests** for one runtime per browser session, no runtime before an enrolled device is available, and status snapshots that expose coordinator state without creating a second coordinator.
- [ ] **Step 2: Run the focused tests to verify the expected failures.**

  Run: `npx vitest run tests/unit/sync/runtime.test.ts tests/unit/sync/coordinator.test.ts`

  Expected: FAIL because the shared runtime and status store do not exist.

- [ ] **Step 3: Implement `src/lib/sync/runtime.ts`** using `getBrowserRepository()`, `getSupabaseBrowserClient()`, `SupabaseSyncRemote`, `SyncCoordinator`, and `RealtimeCoordinator`. Register only one runtime and expose a cleanup function for logout/revocation.
- [ ] **Step 4: Extend `SyncCoordinator` status reporting** so success records `lastSyncedAt`, failures retain a useful message, and pending/conflict counts are refreshed from the repository after each cycle.
- [ ] **Step 5: Mount the runtime from the workspace boundary** without fetching personalized IndexedDB data in a Server Component. Trigger startup, `online`, `visibilitychange` resume, and cleanup events.
- [ ] **Step 6: Run the focused tests and verify they pass.**
- [ ] **Step 7: Commit the shared sync runtime.**

### Task 2: Make inspection completion produce a durable sync outbox item

**Files:**
- Modify: `src/lib/db/records.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/features/inspection/inspection-editor.tsx`
- Test: `tests/unit/db/repository.test.ts`, `tests/unit/inspection/editor.test.tsx`

**Interfaces:**
- `LocalRepository.completeInspection(id: string, inspection: Record<string, unknown>): Promise<void>` remains the public completion API.
- The transaction creates an `OutboxRecord` with `kind: 'inspection'`, `aggregateId: id`, stable payload identifiers, `status: 'pending'`, and `nextAttemptAt` set to the current ISO time.
- `SupabaseSyncRemote.pushOutbox()` continues consuming the existing `inspection_id`, `revisions`, and `events` payload shape.

- [ ] **Step 1: Write failing repository tests** proving completion writes the inspection, activity row, removes the draft, and creates exactly one inspection outbox item atomically.
- [ ] **Step 2: Run `npx vitest run tests/unit/db/repository.test.ts` and verify the new outbox assertion fails.**
- [ ] **Step 3: Implement the outbox payload in `completeInspection`** using the existing backend contract/Flutter payload fixtures; do not invent new RPC arguments.
- [ ] **Step 4: Add a failure-path test** proving a transaction failure leaves the draft and does not leave a partial outbox item.
- [ ] **Step 5: Run repository and inspection editor tests and verify they pass.**
- [ ] **Step 6: Commit the inspection outbox change.**

### Task 3: Reconcile pulled revisions into the local inspection mirror

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/records.ts`
- Modify: `src/lib/supabase/remote-source.ts`
- Test: `tests/unit/db/repository.test.ts`, `tests/unit/supabase/remote-source.test.ts`

**Interfaces:**
- `LocalRepository.applyPullPage(page: PullPage): Promise<void>` applies revisions, activities, conflicts, deletions, and cursor advancement in one transaction.
- `LocalRepository.listCompletedInspections(limit = 500): Promise<InspectionRecord[]>` returns completed inspection records ordered by completion/update time.
- `parsePullPage(value: unknown): PullPage` rejects malformed rows before any cursor is advanced.

- [ ] **Step 1: Write failing tests** for a pulled completed revision becoming visible to `listCompletedInspections`, replayed pages remaining idempotent, and malformed/non-advancing pages leaving cursors unchanged.
- [ ] **Step 2: Run the focused tests to verify the new assertions fail.**
- [ ] **Step 3: Implement revision-to-inspection reconciliation** while preserving the raw `inspectionRevisions` mirror and existing cursor transaction boundary.
- [ ] **Step 4: Implement strict parsing and explicit errors** for malformed sync rows; do not silently convert malformed remote data to empty arrays.
- [ ] **Step 5: Run the focused repository and Supabase adapter tests and verify they pass.**
- [ ] **Step 6: Commit reconciliation changes.**

### Task 4: Build the Sync page and responsive controls

**Files:**
- Create: `src/features/sync/sync-view.tsx`
- Modify: `src/app/(workspace)/sync/page.tsx`
- Test: `tests/unit/sync/sync-view.test.tsx`, `tests/e2e/responsive.spec.ts`

**Interfaces:**
- `SyncView` consumes the shared `SyncStatusStore` and exposes accessible controls named `Sync now` and `Retry sync`.
- `SyncView` renders enrollment, live status, last sync time, pending count, conflict count, and error/retry states.

- [ ] **Step 1: Write failing component tests** for live, syncing, offline, pending, error, and conflict states plus the manual sync action.
- [ ] **Step 2: Run the focused test to verify the new UI assertions fail.**
- [ ] **Step 3: Implement the MUI Sync view** using existing theme tokens, responsive spacing, keyboard-accessible buttons, and preserved local-data messaging.
- [ ] **Step 4: Connect manual sync and retry actions** to `SyncStatusStore.syncNow('manual')` and `syncNow('retry')` without starting parallel cycles.
- [ ] **Step 5: Run focused unit tests and responsive checks and verify they pass.**
- [ ] **Step 6: Commit the Sync page.**

### Task 5: Add local report drafts and consolidated report data

**Files:**
- Modify: `src/lib/db/database.ts`
- Modify: `src/lib/db/records.ts`
- Modify: `src/lib/db/repository.ts`
- Create: `src/features/report/report-model.ts`
- Create: `src/features/report/report-draft.ts`
- Test: `tests/unit/report/report-model.test.ts`, `tests/unit/report/report-draft.test.ts`, `tests/unit/db/database-migrations.test.ts`

**Interfaces:**
- `type ReportDraft = { id: string; storeKey: string; inspectionDate: string; regionProvince: string; monitoringTeam: string; distributorType: 'physical' | 'online' | ''; storeName: string; address: string; email: string; contactNumber: string; storeRepresentative: string; findings: string; recommendations: string; teamLeader: string; acknowledgedBy: string; teamLeaderDesignation: string; representativeDesignation: string; updatedAt: string }`
- `LocalRepository.saveReportDraft(draft: ReportDraft): Promise<void>`
- `LocalRepository.getReportDraft(storeKey: string): Promise<ReportDraft | undefined>`
- `consolidateReportProducts(inspections: InspectionRecord[], storeKey?: string): ConsolidatedProduct[]`
- `buildReportSummary(products: ConsolidatedProduct[]): ReportSummary`

- [ ] **Step 1: Write failing model tests** for fixed ECP rows, unique store/control-number consolidation, same-product multi-inspector handling, NC priority, category de-duplication, and `N/A` zero rates.
- [ ] **Step 2: Run `npx vitest run tests/unit/report/report-model.test.ts` and verify the model assertions fail.**
- [ ] **Step 3: Implement pure report model functions** with explicit normalization for the five ECP types and the inspection fields already used by the editor.
- [ ] **Step 4: Write failing draft and migration tests** for save, reload, update, and isolation between finished stores.
- [ ] **Step 5: Add the Dexie `reportDrafts` table in a new schema version** and implement repository draft methods in transactions.
- [ ] **Step 6: Run report model, draft, migration, and existing repository tests and verify they pass.**
- [ ] **Step 7: Commit the report data layer.**

### Task 6: Add the Report tab and report editor

**Files:**
- Create: `src/features/report/report-view.tsx`
- Create: `src/app/(workspace)/report/page.tsx`
- Modify: `src/components/app-shell/app-shell.tsx`
- Test: `tests/unit/report/report-view.test.tsx`, `tests/e2e/responsive.spec.ts`

**Interfaces:**
- `ReportView` loads `LocalRepository.listCompletedInspections(500)` and the selected store’s `ReportDraft`.
- The view provides a finished-store selector, editable local header fields, generated summary tables, an Annex A preview, and a `Download Word report` action.
- Every report table is rendered when the inspection list is empty; zero rows and `N/A` are data states, not a replacement placeholder.

- [ ] **Step 1: Write failing component tests** for the new navigation item/route, zero-filled report tables, store filtering, draft autosave/reload, NC-first Annex A rows, and accessible download controls.
- [ ] **Step 2: Run the focused test to verify the new assertions fail.**
- [ ] **Step 3: Implement the Report route and add `Report` to desktop navigation, mobile drawer, and primary mobile navigation according to the existing AppShell structure.**
- [ ] **Step 4: Implement the responsive MUI editor** with local draft autosave, error feedback, Summary-derived table values, and no fabricated catalog contact details.
- [ ] **Step 5: Run focused report and responsive tests and verify they pass.**
- [ ] **Step 6: Commit the Report tab and editor.**

### Task 7: Populate the supplied DOCX template in the browser

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/features/report/docx-template.ts`
- Create: `src/features/report/docx-slots.ts`
- Modify: `src/features/report/report-view.tsx`
- Test: `tests/unit/report/docx-template.test.ts`
- QA output: task-local temporary render/diff directories only; do not commit them.

**Interfaces:**
- `populateEmvReportTemplate(input: EmvReportExportInput): Promise<Blob>`
- `EmvReportExportInput = { draft: ReportDraft; summary: ReportSummary; nonCompliantProducts: ConsolidatedProduct[] }`
- `downloadEmvReport(input: EmvReportExportInput): Promise<void>`

- [ ] **Step 1: Add the pinned `jszip@3.10.1` dependency** and write failing tests for loading the retained template, replacing text/table slots, escaping XML-sensitive values, preserving the original source bytes, and producing a DOCX ZIP Blob.
- [ ] **Step 2: Run `npx vitest run tests/unit/report/docx-template.test.ts` and verify the export assertions fail.**
- [ ] **Step 3: Create a documented slot map** for the template’s inspection metadata paragraphs, Monitoring Summary table, Annex A table, findings/recommendations, and signature/designation fields. Keep notice and conformity sections preserve-only.
- [ ] **Step 4: Implement package-level DOCX edits** with JSZip, preserving all unrelated ZIP parts and replacing only the documented `word/document.xml` text/table nodes. Do not rewrite the retained template file.
- [ ] **Step 5: Add the download action** with a deterministic sanitized filename and an actionable error state that leaves the local draft intact.
- [ ] **Step 6: Run DOCX unit tests, render a populated export with the document skill’s `render_docx.py`, inspect every rendered page, and iterate until there is no clipping, overlap, broken table, or unexpected pagination.**
- [ ] **Step 7: Commit the DOCX export implementation and dependency lockfile.**

### Task 8: Run the complete verification and handoff gate

**Files:**
- Modify: `README.md`
- Modify: `docs/backend-contract.md` only if implementation findings require a factual contract note
- Test: all affected unit/e2e tests

- [ ] **Step 1: Run focused sync/report tests.**

  Run: `npx vitest run tests/unit/sync tests/unit/report tests/unit/db/repository.test.ts tests/unit/inspection/editor.test.tsx`

- [ ] **Step 2: Run the complete project checks.**

  Run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.

- [ ] **Step 3: Run responsive browser checks** for desktop, tablet, Android-sized, and iPhone-sized viewports, including navigation, Sync now, report filtering, draft reload, and report download initiation.
- [ ] **Step 4: Verify Supabase behavior separately** with an enrolled test account: pull authorization, outbox RPC success, retry preservation, Realtime-triggered recovery, conflict visibility, and revoked-device denial. Do not call local checks proof of live Supabase readiness.
- [ ] **Step 5: Review DOCX render output and confirm the retained template hash is unchanged.**
- [ ] **Step 6: Update README usage instructions** for Sync now and Word report download, then perform a final staged diff review.
- [ ] **Step 7: Commit the verified implementation and push only after explicit handoff authorization.**
