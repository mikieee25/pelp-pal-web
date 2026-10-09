# Activity, Sync, and Field UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Activity scalable, make sync outcomes diagnosable, preserve product and duplicate context, add explicit canonical-store matching, and harden mobile field workflows.

**Architecture:** Keep the browser local-first model and cursor-based sync protocol. Improve Activity and sync read models first, then add an additive organization store registry for cross-device identity matching, and finally verify the workflows with unit and credential-gated browser tests.

**Tech Stack:** Next.js, React, MUI, TypeScript, Dexie/IndexedDB, Supabase/Postgres, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-activity-sync-qol-design.md`

## Global Constraints

- Preserve existing inspections, stores, outbox records, cursors, and sync history.
- Realtime remains a hint that triggers cursor-based pulls; it never advances cursors directly.
- Do not silently merge stores based only on fuzzy name similarity.
- Do not change existing Supabase RPC signatures except for a separately reviewed additive store-registry API.
- Keep browser E2E tests skipped with a clear reason when live credentials are absent.
- Run `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd test -- --run` after the relevant task group.

---

### Task 1: Finish store-group Activity pagination

**Files:**
- Modify: `src/features/activity/activity-view.tsx`
- Test: `tests/unit/activity.test.tsx`

**Interfaces:**
- Consumes: filtered/deduplicated `ActivityRecord[]`.
- Produces: an initial eight-store render window and an eight-store load-more action.

- [ ] **Step 1: Write the failing test**

Add nine distinct stores with one completed inspection each. Assert eight store headings render, the ninth is absent, and it appears after clicking the load-more button.

- [ ] **Step 2: Run the focused test**

```powershell
npx vitest run tests/unit/activity.test.tsx -t "loads eight store groups"
```

Expected: failure because the current window is inspection-record based.

- [ ] **Step 3: Implement the minimal change**

Group the complete filtered activity set first, slice groups with `ACTIVITY_STORE_PAGE_SIZE = 8`, and compare total groups with visible groups. Rename the button to `Load more stores`.

- [ ] **Step 4: Run Activity tests**

```powershell
npx vitest run tests/unit/activity.test.tsx
```

Expected: all Activity tests pass, including grouping, filtering, duplicate revisions, deletion, and undo.

- [ ] **Step 5: Commit checkpoint**

Only after explicit commit authorization:

```powershell
git add src/features/activity/activity-view.tsx tests/unit/activity.test.tsx
git commit -m "fix(activity): page inspection history by store"
```

### Task 2: Add IndexedDB-backed Activity paging

**Files:**
- Modify: `src/lib/db/records.ts`
- Modify: `src/lib/db/database.ts`
- Modify: `src/lib/db/repository.ts`
- Test: `tests/unit/db/repository.test.ts`
- Test: `tests/unit/activity.test.tsx`

**Interfaces:**
- Consumes: existing `ActivityFilter` and activity mapping logic.
- Produces: `listActivityPage(input): Promise<{ rows: ActivityRecord[]; hasMore: boolean; nextCursor?: { createdAt: string; id: string } }>`.

- [ ] **Step 1: Add the page contract and failing repository test**

Insert more rows than one page. Call `listActivityPage({ limit: 2 })`, then call it with the returned cursor. Assert newest-first ordering, no duplicate IDs, completed filtering, and correct `hasMore`.

- [ ] **Step 2: Add non-destructive Dexie indexes**

Add a new database version containing only the date/store/inspector/product/sync indexes needed for Activity. Do not delete or rewrite existing records.

- [ ] **Step 3: Implement page filling**

Reuse existing outbox-priority enrichment. Apply completion and filter predicates before returning rows; continue reading until the requested page is full or the table is exhausted.

- [ ] **Step 4: Move ActivityView to pages**

Load the first page, append later pages, group the accumulated filtered rows, and keep the full filtered inspection count independent from visible store groups. Remove the `limit: 100000` Activity load.

- [ ] **Step 5: Verify**

```powershell
npx vitest run tests/unit/db/repository.test.ts tests/unit/activity.test.tsx
```

Expected: no repeated or lost records between pages.

### Task 3: Persist safe Activity state and finish mobile UX

**Files:**
- Modify: `src/features/activity/activity-view.tsx`
- Modify: `src/features/lookup/lookup-view.tsx`
- Modify: `src/features/summary/summary-view.tsx`
- Modify: `src/theme/tokens.ts` only if an existing safe-area token is missing
- Test: `tests/unit/activity.test.tsx`
- Test: `tests/unit/lookup.test.tsx`
- Test: `tests/unit/summary.test.tsx`

- [ ] **Step 1: Add persistence tests**

Test restoring valid filters and collapsed store keys. Test malformed storage and assert that defaults are used without throwing.

- [ ] **Step 2: Implement a versioned local-storage key**

Persist only filters, collapsed group keys, and the current store key. Validate each value before applying it. Never persist credentials, inspection payloads, or evidence.

- [ ] **Step 3: Fix responsive edge cases**

Keep menus/selects in portals, contain long control numbers/product details, retain FAB and bottom-navigation safe areas, and scope swipe handlers to cards without interfering with browser navigation.

- [ ] **Step 4: Verify**

```powershell
npx vitest run tests/unit/activity.test.tsx tests/unit/lookup.test.tsx tests/unit/summary.test.tsx
npm.cmd run lint
```

### Task 4: Add sync operation counters and explicit results

**Files:**
- Modify: `src/lib/sync/coordinator.ts`
- Modify: `src/features/sync/sync-status-store.ts`
- Modify: `src/features/sync/sync-view.tsx`
- Modify: the compact shell sync indicator identified with `rg -n "realtimeState|pendingCount|Sync" src/app src/features`
- Test: `tests/unit/sync/coordinator.test.ts`
- Test: `tests/unit/sync/sync-status-store.test.ts`
- Test: `tests/unit/sync/sync-view.test.tsx`

**Interfaces:**
- Consumes: existing `SyncOperation`, `SyncStatusSnapshot`, local counts, and optional remote inspection count.
- Produces: immutable counters/results for Upload inspections, Download inspections, Sync masterlist, and full sync.

- [ ] **Step 1: Add failing tests**

Cover one successful upload, a zero-change download, a retryable failure, and a conflict. Assert counters, status, and retained errors.

- [ ] **Step 2: Extend snapshot types**

Add uploaded, downloaded/applied, unchanged, retrying, conflicted, and failed counters while keeping existing fields compatible. Keep unavailable remote counts as `undefined` plus `diagnosticsError`.

- [ ] **Step 3: Account at acknowledged boundaries**

Increment upload counters after remote acknowledgement, download counters after `applyPullPage`, and retry/conflict counters after the outbox status transition. Represent zero-change pulls explicitly.

- [ ] **Step 4: Update sync action cards and shell indicator**

Show operation-specific progress, counts, zero-change text, errors, and retry controls. Preserve MUI tokens and mobile layout.

- [ ] **Step 5: Verify**

```powershell
npx vitest run tests/unit/sync tests/unit/realtime tests/unit/supabase-sync-remote.test.ts tests/unit/sync/sync-view.test.tsx
```

### Task 5: Improve product snapshot and repeated-inspection clarity

**Files:**
- Modify: `src/features/inspection/inspection-editor.tsx`
- Modify: `src/lib/db/inspection-enrichment.ts`
- Modify: `src/features/activity/activity-view.tsx`
- Modify: `src/app/(workspace)/lookup/lookup-view.tsx`
- Test: `tests/unit/db/inspection-enrichment.test.ts`
- Test: `tests/unit/activity.test.tsx`
- Test: `tests/unit/inspection/editor.test.tsx`

- [ ] **Step 1: Add fallback tests**

Assert precedence: inspection snapshot, synchronized revision fields, local catalog, explicit unavailable state. Missing catalog data must not erase snapshot fields.

- [ ] **Step 2: Centralize fallback enrichment**

Return source metadata (`Catalog`, `Inspection snapshot`, or `Unavailable`) from `inspection-enrichment.ts` so Activity, Lookup, and inspection view share the same result.

- [ ] **Step 3: Add repeated-product disagreement tests**

Assert control number, inspection count, latest outcome/date, expandable history, and a review indicator when revisions disagree.

- [ ] **Step 4: Implement display changes**

Keep every revision accessible through View. Do not discard older revisions or overwrite snapshots while rendering.

### Task 6: Add canonical store registry and alias workflow

**Repositories/files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\20261009000000_add_organization_store_registry.sql`
- Modify: `src/lib/db/records.ts`
- Modify: `src/lib/db/database.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: components under `src/features/store/`
- Modify: revision payload construction in `src/lib/db/repository.ts` and its inspection-editor callers
- Test: `tests/unit/db/repository.test.ts`
- Test: store form/current-store tests under `tests/unit/`
- Test: backend SQL/RLS assertions if the backend repository provides a SQL test harness

**Interfaces:**
- Consumes: enrolled organization identity and existing local store/revision payloads.
- Produces: canonical selection, explicit alias confirmation, offline pending selection, and audit-safe metadata.

- [ ] **Step 1: Create additive backend tables and RLS**

Add organization-scoped canonical stores and aliases with stable IDs, normalized alias uniqueness, active/archive state, confirmer identity, and timestamps. Do not rewrite existing inspections.

- [ ] **Step 2: Add authenticated candidate lookup and confirmation**

Return canonical ID, display name, location, and match reason. Make confirmation idempotent and reject an alias already owned by another canonical store unless an authorized merge path is used.

- [ ] **Step 3: Add local pending-selection storage**

Add a Dexie version/table for canonical references and pending alias decisions. Offline users continue working; the decision resolves after reconnect.

- [ ] **Step 4: Add explicit store-selection UI**

For a possible match, offer Use existing store, Create new store, or Continue offline. Never select a candidate without confirmation.

- [ ] **Step 5: Attach canonical identity to future revisions**

Carry `canonical_store_id` and entered display name in new revisions. Preserve the entered name for auditability. Historical records without a canonical ID remain unchanged.

- [ ] **Step 6: Test safeguards**

Cover normalization, candidate suggestions, idempotent confirmation, conflicting aliases, offline queueing, and no automatic historical merge.

- [ ] **Step 7: Deploy only after dry-run review**

From `C:\Users\mklgr\Codes\pelp_pal_v2`, run `supabase db push --linked --dry-run`, verify only the registry migration is pending, then apply it. Do not use migration repair.

### Task 7: Expand credential-gated E2E coverage

**Files:**
- Modify: `tests/e2e/two-device-sync.spec.ts`
- Modify: `tests/e2e/auth-fixtures.ts`
- Modify: `playwright.config.ts` only if existing setup needs a timeout/project adjustment

- [ ] **Step 1: Add scenarios**

Cover two consecutive edits from device A, device B updating without manual reload, deletion propagation, and offline reconnect.

- [ ] **Step 2: Add explicit skip reasons**

When live credentials or seeded data are absent, skip with the exact required environment/setup reason. Runtime failures must remain failures.

- [ ] **Step 3: Run**

```powershell
npm.cmd run test:e2e -- two-device-sync.spec.ts
```

### Task 8: Final verification and handoff

**Files:**
- Modify: documentation only when setup or operational instructions change

- [ ] **Step 1: Run local gates**

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --run
```

- [ ] **Step 2: Review data safety**

Confirm no migration drops or rewrites inspection data, no cursor is advanced outside the pull path, and no fuzzy store merge occurs without explicit confirmation.

- [ ] **Step 3: Review the diff**

```powershell
git diff --check
git status --short
git diff --stat
```

- [ ] **Step 4: Report deployment requirements**

List web deployment, backend migration application, E2E credential requirements, and intentionally skipped live checks. Do not commit or push unless separately authorized.
