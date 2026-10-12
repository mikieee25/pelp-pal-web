# Account-authenticated sync and device-enrollment retirement

## Status

Approved design. Implementation is intentionally staged. This specification does not apply SQL to a remote Supabase project, delete local data, or retire the Flutter client immediately.

## Goal

Make PELP Pal Web the primary management and reporting system, remove device enrollment as a user-facing and synchronization requirement, and make web/mobile synchronization use personnel account authentication consistently.

The Flutter client remains temporarily supported for offline field capture. It is a transition client, not a second system of record, and is planned for retirement later.

## Current problem

The current sync authorization model treats an anonymous Supabase Auth user as a device identity. Synced rows and server policies resolve `auth.uid()` through `public.devices`. Web therefore keeps a separate device session from the signed-in personnel session, while mobile can replace its device session with the personnel account session during login. That identity collision causes intermittent authorization failures, missing downloads, and confusing re-enrollment errors.

The database also contains device foreign keys across inspections, revisions, activity, evidence, conflicts, tombstones, and enrollment operations. Removing the enrollment screen alone would leave the sync contract broken.

## Target architecture

```text
PELP Pal Web
  - account administration
  - organization and store management
  - catalog management
  - inspection history and correction
  - conflict review and resolution
  - consolidated reports and exports
  - sync diagnostics and recovery

Supabase
  - Auth personnel account is the sync identity
  - organization_accounts is the authorization source
  - account-owned inspection and sync records
  - cursor-based pull and idempotent push

Flutter transition client
  - offline inspection capture
  - local drafts and evidence
  - account-authenticated sync
  - no device enrollment
```

Supabase remains the shared source of truth. The web application is the primary workflow and reference implementation; it does not introduce a web-only sync protocol that the transition client cannot use.

## Identity and authorization

The final sync identity is `organization_accounts.id`, resolved from the signed-in Supabase Auth user through `organization_accounts.auth_user_id`.

Clients must not send trusted organization, username, role, or catalog-scope values. Server-side RPCs and RLS derive those values from the authenticated account.

The current role-scoped visibility is retained initially:

- administrators can see organization data;
- EPRED and guest users retain their assigned scope;
- broadening visibility to every account in an organization is a separate authorization decision.

Signed-out users may continue creating local work, but upload and download are disabled until an account is signed in. The UI must state this explicitly as local-only work rather than presenting it as a sync failure.

## Database transition

The migration is split into additive compatibility and final cleanup phases.

### Additive phase

Add account ownership columns using `organization_accounts.id` as the foreign key. The exact set must cover every row currently owned or written through a device, including:

- inspection owner;
- inspection revision editor;
- activity event author;
- evidence uploader;
- conflict author/resolver where applicable;
- deletion tombstone author where applicable.

Backfill account ownership from the existing organization, username, and device relationships. Evidence rows that only have a device reference must be resolved through the device's organization and assigned username before device data is removed.

The migration must stop with an explicit error if any row cannot be mapped to an active organization account. It must not silently assign an account, drop an orphaned row, or discard inspection data.

During the compatibility period, old device columns may remain nullable for rollback and verification. New writes use account ownership fields.

### Account-based server behavior

Replace device-based logic in:

- pull and push sync RPCs;
- conflict resolution;
- activity and evidence writes;
- inspection and revision RLS;
- activity, conflict, tombstone, and evidence RLS;
- storage object policies;
- catalog and organization-account access checks;
- realtime publication visibility and subscription assumptions.

Cursor semantics remain unchanged. Realtime remains a pull hint and never advances a cursor directly.

### Final cleanup phase

After account-based clients are deployed and data verification passes, remove:

- enrollment RPCs and Edge Functions;
- enrollment-code history/table;
- device-based foreign keys and columns;
- device-only policies and helper functions;
- `public.devices`.

This cleanup is a separate migration and must not be applied remotely without an explicit deployment decision. The final schema contains no operational device-enrollment dependency.

## Local data isolation

The local database must be partitioned by an account scope key derived from the organization and account IDs. Sync-owned rows and outbox entries must never be visible to a different signed-in account.

Required behavior:

- sign-out pauses sync but does not delete local data;
- switching accounts selects the other account's local namespace;
- pending work remains attached to its original account namespace;
- a sync attempt cannot upload another account's outbox entries;
- changing accounts with unsynced work shows an explicit warning and account-specific pending count.

The implementation may use a Dexie schema migration and scope fields, or separate account namespaces, but it must preserve existing local inspections during upgrade.

## Client changes

### Web

- Use the authenticated account Supabase client for sync.
- Remove the separate device Supabase client and anonymous-session bootstrap.
- Remove enrollment routes, enrollment-code flows, device enrollment status, and re-enrollment errors.
- Start sync only when a valid account session exists.
- Add clear local-only, signed-out, account-switch, retry, conflict, and recovery states.
- Keep realtime state separate from last sync result.
- Make the web sync screen the primary operational diagnostic surface.

### Flutter transition client

- Stop calling device enrollment APIs.
- Remove enrollment screens and secure enrollment flags/installation identity used for authorization.
- Use the existing personnel account session for sync.
- Keep offline inspection capture, evidence, outbox, retry, and account-authenticated pull while the client is supported.
- Freeze new management/reporting feature work; future product work belongs in web.

## Sync behavior

The sync pipeline remains cursor-based and idempotent:

1. Require an authenticated personnel account.
2. Push eligible local outbox entries.
3. Pull pages after the local cursors.
4. Apply each page transactionally.
5. Advance each cursor only after successful local application.
6. Retry transient failures with bounded backoff.
7. Use realtime only to trigger a pull.
8. Use visible/online polling as a recovery path when realtime is unavailable.

The UI must expose local pending count, server/local diagnostic counts where available, last successful sync, current operation, retry state, and the actual last error.

## Rollout order

1. Inventory all enrollment/device references in web, Flutter, migrations, Edge Functions, local storage, and tests.
2. Add account ownership fields and backfill checks.
3. Implement and test account-based RPC/RLS/storage behavior.
4. Switch web to account-authenticated sync and make it the reference client.
5. Switch Flutter to account-authenticated sync and remove enrollment behavior.
6. Verify data counts, repeated updates, deletions, evidence, conflicts, offline work, account switching, and realtime recovery.
7. Monitor the transition period and record unmapped or rejected rows.
8. Apply the final cleanup migration only after explicit review and production approval.
9. Retire Flutter after field users have migrated.

## Testing and acceptance

### Web

- account-authenticated sync contract tests;
- local account partition and account-switch tests;
- outbox retry and no-data-loss tests;
- repeated update and conflict tests;
- realtime reconnect and polling fallback tests;
- enrollment removal regression tests;
- lint, TypeScript, Vitest, and production build checks.

### Flutter

- account-authenticated upload/download tests;
- offline-to-online recovery tests;
- retry and delayed-outbox tests;
- account switch isolation tests;
- tests proving no enrollment API is called.

### Supabase

- migration assertions for complete account backfill;
- policy/RPC tests for administrator, EPRED, guest, inactive, and cross-organization access;
- storage and evidence authorization tests;
- cursor monotonicity and repeated-update tests;
- final cleanup blocked when unresolved ownership exists.

Acceptance requires that two accounts can edit or create inspections, the other authorized client receives both updates without a manual refresh, offline work survives sign-out and restart, and no sync path depends on anonymous device enrollment.

## Explicit non-goals

- Retiring Flutter in this implementation.
- Changing role visibility to organization-wide access.
- Changing cursor semantics or creating a second sync protocol.
- Deleting inspection, evidence, conflict, or report data.
- Applying migrations to the remote Supabase project automatically.
- Replacing Supabase with a web-only backend.

## Risks and safeguards

| Risk | Safeguard |
| --- | --- |
| Historical row cannot map to an account | Fail the migration with row identifiers; do not clean up devices |
| Account switch leaks local work | Account-scoped local storage and outbox filtering |
| Flutter has an old client during rollout | Keep a compatibility window and deploy client changes before final cleanup |
| Realtime outage appears as data loss | Cursor pull plus polling fallback and visible diagnostics |
| Cleanup is applied too early | Separate final migration, verification report, and explicit deployment approval |
| Auth account is deleted or recreated | Store stable `organization_accounts.id` ownership, not only `auth_user_id` |
