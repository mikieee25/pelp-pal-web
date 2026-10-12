# Web-primary offline inspection and transfer recovery

## Status

Approved direction; implementation pending spec review.

## Goal

Make PELP Pal Web the primary inspection, reporting, and synchronization system while preserving reliable offline field work and a safe manual recovery path when automatic synchronization is unavailable.

The Flutter client remains a temporary transition client. It continues to use the shared Supabase contract during the compatibility window, but new workflow improvements are implemented in the web application first.

## Non-goals

- Do not replace Supabase.
- Do not introduce a second remote synchronization protocol.
- Do not transfer authentication credentials, browser sessions, service keys, or sync cursors.
- Do not automatically merge stores based on fuzzy names.
- Do not delete local inspections, evidence, drafts, outbox records, or conflicts during import, migration, or application updates.
- Do not require Quick Share, AirDrop, or an installed PWA for transfer.

## Product behavior

### Normal web workflow

1. The signed-in account completes an inspection.
2. The inspection, activity record, evidence metadata/blobs, and outbox item are written locally in one transaction.
3. The web sync coordinator uploads the pending work when online.
4. Other authorized browsers discover changes through realtime hints and cursor-based pull recovery.
5. Polling and manual sync remain available when realtime is unavailable.

The browser remains usable while offline. The UI must distinguish local-only work from a synchronization failure and must never imply that local completion was lost merely because an upload is pending.

### Manual recovery workflow

The Sync screen adds:

- `Export recovery JSON`;
- `Share recovery JSON` when file sharing is supported;
- `Import and merge JSON`;
- a visible explanation that imported records enter the normal upload queue.

Export must support at least pending/retryable work and may offer a full account-scoped local snapshot for backup. Import is explicit and requires user confirmation after validation; selecting a file must not mutate local data before the merge preview is accepted.

## Portable JSON contract

Use a versioned UTF-8 JSON document with the `.pelp.json` filename suffix. The format must be independent of browser, operating system, and JavaScript serialization details.

Example envelope:

```json
{
  "format": "pelp-pal-transfer",
  "schemaVersion": 1,
  "exportMode": "pending",
  "exportedAt": "2026-10-12T08:00:00.000Z",
  "appVersion": "0.1.0",
  "organizationId": "organization-id",
  "sourceAccountId": "account-id",
  "records": {
    "inspections": [],
    "revisions": [],
    "activities": [],
    "evidence": [],
    "evidenceBlobs": [],
    "outbox": []
  }
}
```

### Portability rules

- Encode all text as standard UTF-8 JSON.
- Use ISO 8601 UTC timestamps.
- Keep IDs, revision numbers, and counts as JSON strings/numbers with stable types.
- Encode evidence bytes as standard padded base64 with an explicit MIME type and byte length.
- Include SHA-256 values when available so imported blobs can be verified.
- Preserve stable inspection IDs, revision IDs, activity IDs, evidence IDs, and original inspector metadata.
- Never include Supabase access/refresh tokens, local password verifiers, auth aliases, cookies, service keys, or cursor state.
- Include organization/account metadata only for validation and audit display; the importer must not trust imported ownership values for authorization.
- Reject unsupported `format` or `schemaVersion` values with an actionable message.

The exporter must warn before creating a large file. If evidence makes a full bundle too large for practical mobile sharing, provide a records-only recovery export and clearly state that evidence remains on the source browser. The import preview must show the selected mode, record counts, evidence count, and file size.

## Merge semantics

Import is scoped to the currently authenticated organization. A bundle from another organization is rejected before any local write. Account identity in the file is informational; authorization is determined by the current authenticated Supabase session and existing server policies.

The merge runs in a single IndexedDB transaction after validation:

- same stable ID and identical revision/content: skip as already present;
- imported revision newer than local: apply the imported revision and related activity/evidence;
- imported revision older than local: keep the local record and record it as skipped;
- same ID with incomparable or divergent content: preserve the local record and create a durable local conflict for review;
- imported pending work: create or reconcile a current-account outbox item without copying imported sync cursors;
- imported evidence with a matching checksum: skip duplicate bytes;
- imported evidence with the same ID but different checksum: preserve both safely and surface a conflict;
- imported deletions never remove a local inspection automatically during the first implementation.

The merge must be idempotent. Re-importing the same file must not duplicate inspections, activities, evidence, or outbox entries.

Imported records must go through the existing outbox and RPC path. The client must not call remote tables directly as part of import, and import must not mark records as remotely synchronized.

## iOS and Android transfer behavior

The feature must use standards-based file sharing rather than platform-specific code.

### Sending

1. Create a `File` with the `.pelp.json` name and `application/json` MIME type.
2. Check `navigator.canShare({ files: [file] })` before calling `navigator.share({ files: [file], title, text })`.
3. On iOS, allow Safari or an installed PWA to open the native share sheet, including AirDrop/Files where available.
4. On Android, allow Chrome or an installed PWA to open the native share sheet, including Quick Share/Files where available.
5. If file sharing is unsupported, blocked, canceled, or unavailable on desktop, download the file using the browser download mechanism.

The UI must never assume that a share sheet successfully delivered the file. The result is reported as `shared`, `downloaded`, `canceled`, or `failed`, with the recovery file remaining available for another attempt.

### Receiving

- Always support `<input type="file" accept=".json,application/json">` on iOS Safari, Android Chrome, desktop browsers, and installed PWAs.
- Optionally add Web Share Target support for installed PWAs where the browser exposes it, but do not make it required for correctness.
- Preserve the original selected file until the user completes or cancels the merge preview.
- Handle Files app, Downloads, Quick Share, AirDrop, and ordinary browser downloads as the same JSON input path.
- Avoid URL-length transfer, clipboard-only transfer, data URLs, and platform-specific proprietary file encodings.

## Sync diagnostics

The Sync screen should expose enough information to distinguish an upload problem from a download, authorization, or sharing problem:

- local completed inspection count;
- pending, retrying, failed, conflict, and synced outbox counts;
- last upload and download timestamps;
- last successful cursor pull;
- last upload/download error with a user-safe message;
- realtime state and polling state;
- latest import/export result and record counts;
- an explicit account and organization scope label.

Sensitive payloads and tokens must not appear in diagnostics or console output.

## Web-primary UX changes

- Remove active user-facing device-enrollment requirements from web screens.
- Replace device terminology with browser/account terminology where it describes current behavior.
- Keep a clear offline/local-only state for signed-out or disconnected users.
- Make the web app the reference workflow for inspection, Activity, Summary, Report, Personnel, Lookup, Catalog, and Sync.
- Keep Flutter compatibility for the transition period and avoid backend changes that only the web client understands.
- Add an in-app transition note for administrators before Flutter retirement is formally approved.

## Implementation boundaries

### Web repository

- Add a typed transfer-bundle module with runtime validation, serialization, checksum verification, and merge planning.
- Add repository methods for account-scoped export and transactional merge.
- Reuse the existing outbox and sync coordinator after import.
- Add Sync screen actions, preview/confirmation UI, progress, success, cancellation, and error states.
- Add Web Share API capability detection and download fallback.
- Add unit, integration, and responsive browser tests.

### Shared backend

No new remote protocol is required for the first implementation. Existing Supabase Auth, RLS, RPCs, Storage, cursor semantics, and realtime subscriptions remain authoritative.

If imported work is rejected by current account/organization authorization, surface the server error and preserve the local imported conflict/recovery record. Do not weaken RLS to make JSON transfer succeed.

### Flutter transition client

No immediate Flutter feature work is required for the first web implementation. The JSON format is intentionally generic so a later Flutter export/import bridge can consume the same schema without depending on browser APIs. A separate Flutter implementation must be tested against shared fixtures before claiming cross-client JSON compatibility.

## Testing and acceptance

### Unit tests

- valid pending and full bundle serialization;
- UTF-8 and Unicode store/product names;
- invalid format/version/type rejection;
- missing IDs, duplicate IDs, invalid timestamps, invalid base64, and checksum mismatch;
- same bundle imported twice remains idempotent;
- newer/older/divergent revision merge behavior;
- organization mismatch rejection;
- outbox creation after import;
- no credentials or cursors emitted;
- file-size warning behavior.

### Browser tests

- export downloads a valid `.pelp.json` file;
- Web Share is used only when file sharing is supported;
- share rejection falls back to a recoverable download state;
- file picker works at mobile viewport sizes;
- preview is shown before mutation;
- cancel leaves IndexedDB unchanged;
- import success updates Activity and Sync counts;
- imported work uploads through the normal sync path;
- offline completion, export, import, reconnect, and upload recovery;
- iOS-like and Android-like Web Share API mocks exercise the same contract.

### Acceptance criteria

1. An inspection completed offline remains visible after reload.
2. A pending inspection can be exported from one browser and imported into another browser in the same organization.
3. Re-importing the same JSON does not create duplicates.
4. Imported work appears as pending until Supabase acknowledges it.
5. iOS Safari/Files and Android Chrome/Quick Share use the same `.pelp.json` format and import path.
6. Unsupported sharing APIs still work through download and file selection.
7. No auth token, password, cursor, or service credential appears in the file.
8. Existing Supabase and Flutter sync contracts remain unchanged.

## Rollout

1. Ship the transfer format and validators behind the web Sync screen.
2. Test with disposable accounts and two browsers before production use.
3. Test iOS Safari, Android Chrome, desktop Chrome/Edge, and an installed PWA where available.
4. Monitor import conflicts, rejected uploads, and file-size failures.
5. Keep the feature additive and reversible during the Flutter compatibility window.
6. Retire Flutter only after the web workflow, offline recovery, JSON transfer, and multi-browser sync acceptance tests pass.
