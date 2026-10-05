# PELP Pal Web Backend Contract Handoff

This document is a handoff copy of the repository-owned contract in:

`C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

Source commit: `56f9d8c`  
Status: repository contract and deployed Supabase schema verified on 2026-10-01 for project `qwtdecxiclufsziufele`.

The generated TypeScript snapshot is stored in `src/lib/supabase/database.types.ts`. The live project exposes the
`enroll_device`, `pull_sync_changes`, `push_activity_events`, `push_inspection_revisions`,
`resolve_inspection_conflict`, and `consume_account_reset` RPCs. The `enroll-device` Edge Function wraps
`enroll_device` and hashes the one-time code before invoking it.

The web client must not implement remote calls until its generated types, RPC wrappers, fixtures, and authorization tests match the source contract. The source repository remains the owner of Supabase migrations and SQL authorization.

## Credentials-first compatibility window

The credentials-first identity fixture and acceptance rules are owned by:

`C:\Users\mklgr\Codes\pelp_pal_v2\docs\superpowers\specs\2026-10-01-credentials-first-auth-migration.md`

Until account-based authorization is fully deployed, the web client must treat the existing device-based RPC
signatures as compatibility contracts. Legacy `devices`, enrollment records, and historical `device_id` values
remain readable; they must not be rewritten or used as proof of a new account identity. The account migration must
preserve the existing cursor and payload shapes while moving authorization resolution to `current_account()`.

## Remaining integration blockers

- Live verification currently covers anonymous session reachability, the `pull_sync_changes` response shape, and schema
  generation. A disposable enrolled device is still required to verify authorized data and write paths.
- Realtime publication membership is not declared in the inspected repository migrations.
- Revoked-device denial must be verified for Data API, RPC, Storage, and Realtime access.
- The deployed schema does not expose `delete_inspection_sync` in generated RPC types; deletion behavior must be
  reconciled against the Flutter client before the web delete workflow is implemented.
