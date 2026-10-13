# PELP Pal Web Backend Contract Handoff

This document is a handoff copy of the repository-owned contract in:

`C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

Status: account-authenticated sync contract verified against the current project state on 2026-10-13 for project `qwtdecxiclufsziufele`.

The generated TypeScript snapshot is stored in `src/lib/supabase/database.types.ts`. The active project exposes
account-authenticated synchronization through `pull_sync_changes`, `push_activity_events`,
`push_inspection_revisions`, `resolve_inspection_conflict`, `delete_inspection_sync`, and
`consume_account_reset`. There is no active `enroll_device` RPC, enrollment-code flow, or `devices` table.

The web client must keep its generated types, RPC wrappers, fixtures, and authorization tests aligned with this contract. The source repository remains the owner of Supabase migrations and SQL authorization.

## Account-authenticated sync

`organization_accounts.auth_user_id` maps the signed-in Supabase Auth user to
the organization, username, role, and active state. Sync RPCs resolve the
current account through `current_account()` and preserve the existing cursor
and payload shapes. Clients must establish a signed-in session before calling
sync RPCs or private evidence storage.

## Remaining integration blockers

- Live verification must cover signed-in account reachability, the `pull_sync_changes` response shape, and authorized
  write and Storage paths.
- Realtime publication membership is not declared in the inspected repository migrations.
- Inactive-account denial must be verified for Data API, RPC, Storage, and Realtime access.
