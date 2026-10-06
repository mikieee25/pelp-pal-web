# PELP Pal Catalog Publishing

**Status:** Approved for implementation  
**Date:** 2026-10-06  
**Scope:** PELP Pal Web Account UI plus the shared PELP Pal V2 Supabase contract

## Decision

Add an administrator-only catalog publishing workflow to the Account tab using an **Upload → Review → Publish** flow. The Sync and Lookup screens continue to consume the existing catalog_manifests and catalogs Storage contract; they do not become catalog administration screens.

The web client must not receive a service-role key and must not write catalog_manifests directly. The privileged upload and publish boundary belongs in the PELP Pal V2 Supabase backend repository, which owns migrations, Edge Functions, Storage policies, and authorization.

## Current contract evidence

- The existing web catalog sync already reads the published masterlist manifest, downloads its Storage object, verifies SHA-256, validates row count, and atomically replaces the local IndexedDB catalog.
- The production database exposes public.current_account() and therefore has an account-based authorization boundary for administrator checks.
- No catalog publishing RPC or Edge Function currently exists.
- The current production catalogs bucket is public and has no catalog-specific storage.objects policy. This must be addressed before treating the catalog as organization-scoped private data.
- The current public/masterlist.json is approximately 50 MB and contains 12,817 rows, so the upload must not send the full file through a small request body or a normal server action.

## User experience

### Account tab

For an active administrator only, add a Catalog management card containing:

- Current published version, row count, and published timestamp.
- Upload masterlist.json file picker.
- Validation state and upload progress.
- Review summary:
  - file name and size;
  - row count;
  - product types;
  - duplicate-ID count;
  - SHA-256 digest;
  - detected schema version.
- Publish masterlist confirmation action.
- Clear success state showing the new version and explaining that enrolled devices receive it on their next Sync or Lookup refresh.

Non-admin accounts must not see the management controls. The server must still authorize every operation; hiding controls is not an authorization mechanism.

### Upload lifecycle

1. The browser validates the selected JSON locally and computes metadata.
2. The browser requests an upload session from the protected backend.
3. The backend verifies the authenticated account is active and has role = admin, then returns a one-time signed Storage upload target.
4. The browser uploads the file directly to Storage with progress reporting.
5. The browser displays the review summary and waits for explicit publish confirmation.
6. The backend finalizes the upload by verifying the object, recalculating its digest and row count, validating the catalog shape, and updating the current manifest atomically.
7. The published catalog uses one fixed object per organization and role so replacement does not accumulate old Storage objects. The previous object is overwritten after verification; rollback therefore requires an external backup or a device that still has the previous local catalog.

## Backend contract

The PELP Pal V2 repository should add a protected catalog publishing function, preferably with explicit initiate and finalize actions to keep the API small:

POST /functions/v1/catalog-publish

Initiate request:

~~~json
{
  "action": "initiate",
  "catalog_role": "masterlist",
  "file_name": "masterlist.json",
  "row_count": 12817,
  "sha256": "...",
  "schema_version": 1
}
~~~

Initiate response:

~~~json
{
  "upload_path": "<organization-id>/masterlist/incoming/<upload-id>.json",
  "token": "<one-time-storage-upload-token>"
}
~~~

Finalize request:

~~~json
{
  "action": "finalize",
  "upload_path": "<organization-id>/masterlist/incoming/<upload-id>.json",
  "sha256": "...",
  "row_count": 12817,
  "schema_version": 1
}
~~~

Finalize response:

~~~json
{
  "catalog_role": "masterlist",
  "version": 43,
  "row_count": 12817,
  "integrity_hash": "...",
  "storage_path": "<organization-id>/masterlist/masterlist.json",
  "published_at": "2026-10-06T00:00:00.000Z"
}
~~~

The server must not trust client metadata. It must recalculate and validate the uploaded object before changing catalog_manifests. Publishing must update the single current manifest for the organization and catalog role while preserving version monotonicity under concurrent administrator requests.

## Storage and authorization

- Keep the bucket private for organization-scoped catalog data.
- Use one organization-scoped published Storage path per catalog role, with a separate temporary incoming path for each upload.
- Allow authenticated catalog reads only when the caller's account/device catalog scope permits the requested role.
- Allow uploads only through the protected publish function; do not grant general browser insert/update access to storage.objects.
- Do not place service-role or secret keys in Vercel environment variables with a NEXT_PUBLIC_ prefix or in browser code.
- Do not retain old published objects in Storage; the fixed published object is overwritten to control free-plan usage. Keep the previous local device catalog as the short-term recovery path and export an external backup before high-risk production updates.
- Run Supabase security and performance advisors after the backend migration.

Because existing clients may currently reference a public masterlist.json path, the backend rollout must preserve a compatibility window or coordinate a single migration for both Flutter and web clients before making the bucket private.

## Client implementation boundaries

Web changes belong in this repository:

- Account catalog management card and responsive states.
- File validation and SHA-256 metadata calculation.
- Signed upload progress handling.
- Review and publish confirmation UI.
- Catalog manifest refresh after success.
- Unit tests for validation, role visibility, failed upload, cancellation, and successful publish.

Backend changes belong in pelp_pal_v2:

- Edge Function implementation.
- Storage bucket and RLS/policy migration.
- Manifest publication transaction or RPC.
- Authorization tests for admin, EPRED, guest, different organization, inactive, revoked, and unenrolled callers.

## Failure handling

- Invalid JSON, duplicate IDs, missing IDs, and unsupported schema fields stop before upload.
- Upload interruption leaves no published manifest change.
- Finalization hash or row-count mismatch leaves the manifest unchanged. If the manifest update fails after replacement, the function attempts to restore the previous object before reporting the failure; the operation must still be retried and monitored because Storage and the manifest are separate systems.
- A failed publish reports an actionable error and keeps the previous catalog available.
- Repeated clicks must be idempotent and must not create two active manifests.
- Devices that cannot download the new catalog retain their last valid local catalog and show a sync error; they must not replace it with partial data.

## Verification plan

### Web

- Admin sees and can use catalog management.
- EPRED and guest accounts do not see publishing controls.
- A malformed or duplicate-ID file is rejected before upload.
- A valid file shows a review summary before publishing.
- Upload progress, cancellation, retry, and publish errors are usable on mobile.
- Successful publishing causes the next catalog sync to replace the local masterlist atomically.

### Backend

- Admin can initiate and finalize for its organization.
- Non-admin, inactive, revoked, and cross-organization callers are denied.
- A client cannot publish a manifest by directly updating the table.
- Storage reads follow the catalog scope contract.
- Concurrent publishes preserve one current manifest and monotonic versions.
- Existing Flutter sync and web sync continue to read the same manifest shape.

### Rollout

1. Implement and test the backend on the development Supabase project.
2. Implement the Account UI against that function contract.
3. Upload a staging masterlist and verify Lookup on multiple enrolled devices.
4. Apply the reviewed backend migration and function to the shared PELP Pal V2 project.
5. Run a read-only production verification before enabling real publishing, with an external copy of the current masterlist retained outside Storage.
