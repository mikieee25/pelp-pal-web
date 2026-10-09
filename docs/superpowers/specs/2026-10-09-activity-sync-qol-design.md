# Activity, Sync, and Field UX Improvements

**Date:** 2026-10-09
**Status:** Design approved for implementation planning

## Goal

Make PELP Pal easier to operate in the field at larger data volumes, make sync failures diagnosable without database access, prevent misspelled stores from fragmenting reporting, and improve mobile reliability without changing already-captured inspection data silently.

## Current context

- Activity reads local activity rows through `LocalRepository.listActivity` and groups them in `ActivityView`.
- Activity now renders eight store groups initially; the current working-tree change is intentionally preserved as the starting point for this work.
- Sync uses cursor-based pull/push coordination. Realtime only triggers a pull and does not own cursor advancement.
- `SyncCoordinator` and `SyncStatusStore` already expose pending/conflict/failed counts, local inspection count, remote inspection count, operation timestamps, and realtime state.
- Store profiles are local IndexedDB records. A saved store has a `storeId`, but the current fallback generator is device-local and random, so two users can create different IDs for the same misspelled store.
- Remote inspection metadata is carried in inspection revisions/activity payloads rather than a dedicated shared store table.

## Goals

1. Keep Activity responsive as local records grow beyond the current hundreds-of-records scale.
2. Expose enough sync evidence to distinguish “not uploaded,” “not downloaded,” “filtered locally,” and “conflict/retry.”
3. Establish an explicit canonical-store workflow without silently combining unrelated stores.
4. Preserve product snapshots and repeated inspections when the current catalog is unavailable.
5. Make common field workflows reliable on narrow screens and touch devices.
6. Cover the highest-risk flows with deterministic unit and browser tests.

## Non-goals

- No destructive cleanup of existing inspections, stores, outbox items, or IndexedDB databases.
- No automatic fuzzy merge based only on a similar store name.
- No replacement of the cursor-based sync protocol with polling-only, timestamps, or client-managed cursors.
- No new third-party dependency unless an existing implementation cannot meet the requirement.
- No claim of production readiness without lint, typecheck, unit, and available E2E evidence.

## Design decisions

### 1. Activity uses store-group pagination

The read model remains local-first. `ActivityView` groups the filtered, deduplicated activity set first, then renders a window of store groups. The initial window is eight groups, and each “Load more stores” action adds eight more groups. Inspection counts and filter counts continue to represent the full filtered set, not only the visible window.

The repository path will be improved separately so Activity does not need to materialize an arbitrary `100000`-row array as the dataset grows. The first implementation should preserve the current public behavior, then add a page-oriented repository method backed by IndexedDB indexes for date, store, inspector, product type, and sync status. Paging must apply filtering before deciding whether another page is needed so a page containing only non-completed or filtered rows cannot make the UI appear empty prematurely.

### 2. Sync diagnostics are derived from existing sync boundaries

`SyncCoordinator` remains the source of operation state. It will record per-operation counters and outcomes while the operation is running:

- uploaded successfully;
- downloaded/applied;
- skipped or unchanged;
- pending/retrying;
- conflicts;
- failed items;
- last successful upload and download times.

`SyncStatusStore` will expose the immutable snapshot to the full Sync page and compact shell indicator. The UI will show separate Upload inspections, Download inspections, and Sync masterlist actions with operation-specific progress and result text. A failed operation will retain its error and expose a retry action; a successful operation with zero changes will say so explicitly.

Remote inspection count continues to use the existing optional remote-count capability. If it is unavailable, the UI must say “unavailable” rather than displaying zero. No RPC signature or cursor behavior changes are needed for these diagnostics.

### 3. Canonical store identity is explicit and reviewable

`storeId` is the authoritative identity whenever present. Name/location normalization is used only to find possible matches, never to merge automatically.

The durable cross-device solution is a shared organization store registry:

- canonical store record: stable ID, organization, display name, normalized name, location, address, active/archive state;
- alias record: submitted spelling, normalized alias, canonical store ID, who confirmed it, and confirmation time;
- unique organization-scoped normalized alias constraint;
- administrative or authorized field workflow to create a new store, select an existing candidate, or request/confirm an alias.

Inspection revisions will carry the canonical store ID plus the entered display name. Existing historical records without a canonical ID remain unchanged and are only presented as possible matches until explicitly mapped. Mapping must be auditable and reversible at the metadata level; it must not rewrite inspection ownership or delete rows.

Because the current web database does not contain a shared store table, this part requires a backend migration, RLS policies, and a small authenticated API/RPC surface. The migration must be additive and idempotent. The client must continue to work offline by storing a pending store-selection decision and attaching the canonical ID once it is available.

### 4. Product snapshot and duplicate presentation

Inspection view will use this display priority:

1. catalog snapshot stored with the inspection;
2. synchronized inspection revision fields;
3. current local catalog;
4. explicit unavailable state.

Activity repeated-product groups will show the canonical control number, inspection count, latest outcome/date, and expandable historical inspections. If revisions disagree on outcome or product identity, the group will show a review indicator rather than hiding the disagreement.

### 5. Field UX state and responsive behavior

- Persist non-sensitive Activity filters and collapsed store keys locally per browser/device.
- Restore the active store and return route only when the stored record still exists.
- Use explicit loading, empty, stale, offline, and error states on Activity, Lookup, Summary, and Sync.
- Keep dropdowns in portals/overlays so opening them cannot change document width or shift content.
- Preserve horizontal containment for long control numbers and product details.
- Keep swipe-to-delete scoped to the card and prevent accidental browser navigation gestures; retain keyboard and action-menu deletion paths.
- Keep FAB/mobile-navigation positioning within safe-area insets and maintain touch targets of at least 44px.

### 6. Verification strategy

Unit coverage will cover:

- store-group pagination and filter/count invariants;
- IndexedDB activity paging and ordering;
- sync operation counters and error/retry states;
- canonical store normalization, alias suggestions, and explicit merge safeguards;
- snapshot fallback and duplicate/conflict presentation;
- persisted filters and active-store restoration.

Browser coverage will cover:

- two-device consecutive edits without manual refresh;
- upload/download with zero-change and failure results;
- retry after offline recovery;
- deletion propagation;
- enrollment mismatch;
- canonical store selection and alias confirmation when live credentials are available.

The live Supabase scenarios remain gated behind the existing E2E environment flag. Skipped tests must report the missing environment requirement rather than silently passing as ordinary tests.

## Phased delivery

### Phase 1: Activity scale and field UX

Finish the current eight-store change, rename its action, add repository paging/indexes, persist safe view state, and fix responsive overlay/gesture edge cases. This phase is deployable without a backend migration.

### Phase 2: Sync observability

Add operation counters/results, improve the three sync actions, wire the compact indicator, and add tests for success, zero-change, retry, conflict, and remote-count-unavailable states.

### Phase 3: Product and duplicate clarity

Implement snapshot fallback, repeated-product summaries, disagreement indicators, and corresponding inspection/activity tests.

### Phase 4: Canonical store registry

Add the additive backend schema/RLS/API, then add offline-aware client selection and alias confirmation. Backfill only explicit mappings; do not guess or rewrite historical records automatically.

### Phase 5: End-to-end hardening

Run the full local verification suite and the credential-gated browser scenarios, document any environment-blocked checks, and review performance with representative local datasets.

## Acceptance criteria

- Activity initially renders at least eight stores when eight or more stores exist, without changing the full filtered inspection count.
- Activity can continue loading stores without duplicating or losing groups.
- Sync users can see which operation ran, how many records changed, and why an operation failed or produced no changes.
- Remote-count failures are distinguishable from zero remote records.
- Similar store names produce a reviewable candidate, never an automatic merge.
- Product details remain useful when the catalog is unavailable but an inspection snapshot exists.
- Existing inspection data remains recoverable throughout migrations and client upgrades.
- `npm run lint`, `npx tsc --noEmit`, and `npx vitest run` pass; live E2E tests either pass or are skipped with a clear credential/setup reason.
