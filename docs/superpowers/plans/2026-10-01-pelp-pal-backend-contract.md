# PELP Pal Shared Backend Contract Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze and harden the Supabase contract used by `pelp_pal_v2` and the separate `pelp-pal-web` client without breaking Flutter behavior.

**Architecture:** `C:\Users\mklgr\Codes\pelp_pal_v2` remains the owner of Supabase migrations, Edge Functions, SQL security, and interoperability fixtures. The web repository consumes the verified contract; it does not create a second migration history. Realtime events are hints that trigger cursor-based synchronization, never the durable source of truth.

**Tech Stack:** Supabase Postgres, SQL migrations, Supabase Edge Functions, Dart/Flutter tests, TypeScript/Deno function tests.

**Spec:** `C:\Users\mklgr\Codes\pelp-pal-web\plan.md`

## Global Constraints

- Read and modify backend files only in `C:\Users\mklgr\Codes\pelp_pal_v2`.
- Do not apply a migration to the live project until the repository contract and deployed state are compared.
- Preserve Flutter RPC names, payload fields, role semantics, and local reset behavior.
- Do not expose a service-role or secret key to either client.
- Treat cursors as durable synchronization state; Realtime cannot advance a cursor.
- Do not delete devices, inspections, tombstones, evidence, or unsynced local data during verification.

---

### Task 1: Inventory the repository and deployed contract

**Files:**
- Inspect: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\migrations\*.sql`
- Inspect: `C:\Users\mklgr\Codes\pelp_pal_v2\supabase\functions\**\index.ts`
- Inspect: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\sync\data\remote_sync_source.dart`
- Inspect: `C:\Users\mklgr\Codes\pelp_pal_v2\lib\features\auth\data\auth_service.dart`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

**Produces:** A contract table with exact function signatures, grants, RLS policies, Storage rules, Edge Function request/response bodies, table columns, cursor fields, role scope, and evidence limits.

- [ ] **Step 1: Inspect the current Flutter call sites.** Record the exact request fields used by `RemoteSyncSource`, including the current five-argument `pull_sync_changes` call and the deletion call.
- [ ] **Step 2: Inspect migration supersession.** Resolve whether `delete_inspection_sync` is absent, present only in migrations, or deployed. The latest repository migration defines it with `p_storage_paths TEXT[] DEFAULT ARRAY[]::TEXT[]`; do not rely on the older plan correction.
- [ ] **Step 3: Compare deployed signatures.** Use the supported Supabase SQL inspection path to query `pg_proc`, `information_schema.routines`, `pg_policies`, `storage.buckets`, and `pg_publication_tables`.
- [ ] **Step 4: Record unknown live state explicitly.** Mark any repository/live mismatch as a release blocker rather than silently choosing one version.
- [ ] **Step 5: Run existing focused tests.** From `C:\Users\mklgr\Codes\pelp_pal_v2`, run:

```powershell
flutter test test/features/sync test/features/auth
```

- [ ] **Step 6: Commit the contract document in the backend repository.** Keep the web repository’s copy, if any, generated or manually synchronized from this source.

### Task 2: Freeze cross-client payloads and credential fixtures

**Files:**
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\fixtures\interop\inspection-revision.json`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\fixtures\interop\sync-page.json`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\fixtures\interop\account-reset-command.json`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\fixtures\interop\argon2id-vectors.json`
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\interop_contract_test.dart`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

**Interfaces:**
- Revision payloads contain stable UUIDs, `revision`, `base_revision`, `parent_client_revision_id`, `client_created_at`, and the JSON inspection payload.
- Sync pages contain `revisions`, `activities`, `conflicts`, and `deletions`, each with a monotonic `change_cursor`.
- Account reset fixtures preserve `password_hash` and all-or-none masterlist wrapper fields.
- Argon2id fixtures preserve the Flutter `$argon2id$...` format, parameters, base64url encoding, and expected verification result.

- [ ] **Step 1: Generate fixtures from existing Flutter serializers and test values.** Do not hand-author fields that are already emitted by the application.
- [ ] **Step 2: Add Dart round-trip tests.** Parse each fixture, serialize it, and assert the required fields and enum values remain stable.
- [ ] **Step 3: Document compatibility rules.** Include nullable fields, unknown-field handling, timestamp normalization, and idempotency identifiers.
- [ ] **Step 4: Run:**

```powershell
flutter test test/interop_contract_test.dart test/features/sync
```

### Task 3: Enforce revoked-device authorization across every access path

**Files:**
- Create with `supabase migration new enforce_revoked_device_access` from `C:\Users\mklgr\Codes\pelp_pal_v2`.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\supabase\revoked_device_access_test.sql`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

**Required behavior:** A device with `revoked_at IS NOT NULL` cannot read organization data, pull sync pages, push revisions/activity, resolve conflicts, consume resets, upload/download evidence, download catalog objects, or continue a Realtime subscription with usable data.

- [ ] **Step 1: Add revoked-device predicates to table and Storage policies.** Include account reset, catalog, inspection, revision, conflict, activity, evidence, tombstone, catalog-object, and evidence-object paths.
- [ ] **Step 2: Verify every `SECURITY DEFINER` function.** Require `auth.uid()` to resolve to an enrolled, non-revoked device before reading or writing data.
- [ ] **Step 3: Keep `SET search_path` explicit.** Use schema-qualified names in definer functions and retain explicit `REVOKE`/`GRANT` statements.
- [ ] **Step 4: Write SQL regression cases for admin, EPRED, guest, different organization, revoked, and unenrolled identities.** Assert denial, not merely an empty result, for protected operations.
- [ ] **Step 5: Run the supported Supabase security advisor and migration checks.** Record the command, result, and deployment target in the contract document.

### Task 4: Add the Realtime publication without changing the sync protocol

**Files:**
- Create with `supabase migration new publish_sync_tables` from `C:\Users\mklgr\Codes\pelp_pal_v2`.
- Create: `C:\Users\mklgr\Codes\pelp_pal_v2\test\supabase\realtime_publication_test.sql`
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

**Published tables:** `devices`, `organization_accounts`, `account_reset_commands`, `catalog_manifests`, `inspections`, `inspection_revisions`, `activity_events`, `inspection_conflicts`, `inspection_evidence`, and `inspection_deletion_tombstones`.

- [ ] **Step 1: Add only missing tables to `supabase_realtime`.** Make the migration idempotent by checking `pg_publication_tables` before altering the publication.
- [ ] **Step 2: Keep Realtime payloads authorization-scoped.** Do not use publication membership as a substitute for RLS or Storage policies.
- [ ] **Step 3: Test that an authorized change produces a notification and an unauthorized organization does not receive usable data.**
- [ ] **Step 4: Document that Flutter remains cursor-synchronized unless a separate Flutter Realtime implementation is added.**

### Task 5: Verify Flutter compatibility and hand off the contract

**Files:**
- Modify: `C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`
- Create: `C:\Users\mklgr\Codes\pelp-pal-web\docs\backend-contract.md`

- [ ] **Step 1: Run the focused Flutter sync/auth/evidence suites.**
- [ ] **Step 2: Run the SQL authorization and Realtime tests against a disposable project or local Supabase instance.**
- [ ] **Step 3: Copy the verified contract into the web repository with its source commit and verification date.**
- [ ] **Step 4: Mark the web implementation unblocked only when RPC signatures, publication membership, role visibility, and revocation behavior all match.**

**Verification gate:** The backend plan is complete only when the Flutter suite passes, SQL authorization tests pass, Realtime publication membership is verified, and no live/repository contract mismatch remains unexplained.
