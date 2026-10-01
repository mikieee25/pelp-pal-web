# PELP Pal Web Backend Contract Handoff

This document is a handoff copy of the repository-owned contract in:

`C:\Users\mklgr\Codes\pelp_pal_v2\docs\backend-contract.md`

Source commit: `56f9d8c`  
Status: repository-verified; deployed Supabase state and Realtime publication are not yet live-verified.

The web client must not implement remote calls until its generated types, RPC wrappers, fixtures, and authorization tests match the source contract. The source repository remains the owner of Supabase migrations and SQL authorization.

## Current integration blockers

- Local Supabase was unavailable at audit time (`127.0.0.1:54322` connection refused).
- Realtime publication membership is not declared in the inspected repository migrations.
- Revoked-device denial must be verified for Data API, RPC, Storage, and Realtime access.
- The deployed project may differ from the checked-out migration history.
