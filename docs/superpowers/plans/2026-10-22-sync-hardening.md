# Sync Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline with test-first checkpoints.

**Goal:** Make inspection synchronization resilient so one failed item, photo, account transition, or deletion cannot corrupt scope or block unrelated sync work.

**Architecture:** Keep local photo capture and evidence records, but treat inspection revision acknowledgement as the primary sync unit. Photo uploads/downloads remain per-photo best-effort work. Every asynchronous database write is guarded by the account scope captured at operation start, and remote deletion/retry states are reconciled explicitly.

**Tech Stack:** Next.js 16, TypeScript, Dexie/IndexedDB, Supabase RPC and Storage, Vitest.

**Spec:** Read-only sync audit in the preceding conversation; findings are captured in the final audit response.

## Global Constraints

- Preserve local photos and existing inspection payload compatibility.
- Do not deploy or modify the remote Supabase project from this task.
- Do not delete existing server evidence or local user data.
- Write regression tests first, verify each red, then implement the smallest fix.
- Keep the worktree free of unrelated changes.

### Task 1: Isolate push failures from the sync run

**Files:**
- Modify: `src/lib/sync/coordinator.ts`
- Test: `tests/unit/sync/coordinator.test.ts`

- [ ] Add tests proving a failed push still performs the post-push pull, photo phase, count refresh, and records the item-level failure without rejecting the full sync.
- [ ] Change the push loop to continue through all due items and retain failure counts/errors in the snapshot.
- [ ] Keep account-scope cancellation and abort errors fatal, because they invalidate the run.
- [ ] Verify focused coordinator tests.

### Task 2: Make evidence best-effort and canonical

**Files:**
- Modify: `src/lib/supabase/remote-source.ts`
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/supabase/evidence-repair.ts`
- Test: `tests/unit/sync/remote-source.test.ts`
- Test: `tests/unit/db/repository.test.ts`

- [ ] Add tests for zero uploads when `needsUpload` is false, canonical upload paths, and failed local evidence not blocking revision acknowledgement where metadata is available.
- [ ] Skip due evidence tasks whose stored hash is already uploaded.
- [ ] Normalize upload-task creation to canonical paths while retaining stored paths for deletion.
- [ ] Pass the abort signal through storage upload requests where supported.
- [ ] Keep missing/invalid local evidence visible as a per-photo failure instead of throwing after revision acknowledgement.

### Task 3: Close account-scope races and recover interrupted outbox rows

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/sync/runtime.ts`
- Test: `tests/unit/db/repository.test.ts`
- Test: `tests/unit/sync/coordinator.test.ts`

- [ ] Add tests for scope changes during lazy evidence download and local completion writes.
- [ ] Assert the captured scope inside every affected Dexie write transaction.
- [ ] Immediately recover rows left in `pushing`/`uploading` when a run is cancelled for an account change.
- [ ] Clear account-keyed in-memory evidence caches when scope changes.
- [ ] Ensure unscoped legacy activity is not exposed to an active account.

### Task 4: Correct remote deletion and conflict evidence behavior

**Files:**
- Modify: `src/lib/db/repository.ts`
- Test: `tests/unit/db/repository.test.ts`

- [ ] Add tests that fully synced tombstones remove local records, while pending/retry/failed/conflict or newer local edits become conflicts.
- [ ] Implement the synced-vs-local-work distinction.
- [ ] Preserve stored remote paths for delete requests.
- [ ] Add regression coverage for evidence metadata during conflict resolution.

### Task 5: Fix photo limits and status visibility

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/app/(workspace)/dashboard/dashboard-view.tsx`
- Test: `tests/unit/db/repository.test.ts`
- Test: `tests/unit/dashboard.test.tsx` or the existing dashboard test file

- [ ] Use `MAX_EVIDENCE_IMAGES` and the shared three-photo message in repository writes.
- [ ] Include failed evidence uploads in Dashboard attention state.
- [ ] Keep Sync page photo counts separate from inspection counts.

### Task 6: Add organization store sync without destructive migration

**Files:**
- Inspect and modify only if a matching existing server contract exists: `src/lib/db/repository.ts`, `src/lib/supabase/remote-source.ts`, relevant Supabase types/migrations.
- Test: existing store/recovery/sync test files.

- [ ] First verify whether the deployed/current repository contract has organization store RPCs or table access.
- [ ] If no contract exists, do not invent a server schema; document that store-profile propagation remains blocked and preserve the current local behavior.
- [ ] If a contract exists, add account-scoped outbox/pull reconciliation with conflict-safe upserts.

### Task 7: Full verification

- [ ] Run focused tests after each task.
- [ ] Run lint, typecheck, full unit tests, production build, and browser tests.
- [ ] Review the final diff for scope leaks, destructive behavior, and unrelated changes.
- [ ] Report any server-side items that require an unapplied migration or deployment.
