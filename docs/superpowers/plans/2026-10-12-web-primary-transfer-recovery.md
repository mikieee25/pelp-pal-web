# Web-Primary Transfer and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app the primary inspection workspace and add a safe, versioned JSON export/import recovery path that works through iOS, Android, desktop browsers, and the existing Supabase outbox sync.

**Architecture:** Keep Supabase Auth, RLS, Storage, RPCs, cursor semantics, and realtime/polling unchanged. Add a typed transfer boundary over the existing account-scoped Dexie repository; import validates and previews a bundle, merges it transactionally into IndexedDB, and creates current-account outbox work for the existing sync coordinator. Use the Web Share API only as an optional file-delivery enhancement, with browser download and file selection as the universal fallback.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI 7, Dexie 4, Web Crypto SHA-256, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-web-primary-transfer-recovery-design.md`

## Global Constraints

- Do not replace Supabase or introduce a second remote synchronization protocol.
- Do not change Supabase RPC signatures, RLS, cursor semantics, realtime cursor behavior, or the Flutter-compatible backend contract.
- Do not transfer authentication credentials, browser sessions, service keys, passwords, cookies, or sync cursors.
- Do not automatically merge stores by fuzzy name matching.
- Do not delete local inspections, evidence, drafts, outbox records, or conflicts during import.
- Use `.pelp.json`, `application/json`, UTF-8, ISO 8601 UTC timestamps, stable IDs, and versioned runtime validation.
- Imports are scoped to the currently authenticated organization and must be idempotent.
- Imported work must enter the existing outbox and remain pending until the existing remote RPC acknowledges it.
- Support iOS Safari/Files/AirDrop, Android Chrome/Quick Share/Files, desktop browsers, and installed PWAs through the same file format.
- Preserve the existing uncommitted Activity pagination changes; do not stage or overwrite them while implementing this feature.
- Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and focused transfer tests before claiming completion.
- Do not commit or push without explicit authorization.

---

### Task 1: Define and validate the portable transfer contract

**Files:**
- Create: `src/lib/transfer/transfer-types.ts`
- Create: `src/lib/transfer/transfer-codec.ts`
- Create: `tests/unit/transfer/transfer-codec.test.ts`
- Reference: `src/lib/db/records.ts`, `src/lib/evidence/validation.ts`

**Interfaces:**
- Consumes: account-scoped local records and `Blob` values from the repository.
- Produces: `TransferBundle`, `TransferExportMode`, `TransferImportPreview`, `TransferImportPlan`, `serializeTransferBundle`, `parseTransferFile`, `previewTransferBundle`, `encodeEvidenceBlob`, and `decodeEvidenceBlob`.

Use these shared fixture and result shapes in the tests and later tasks:

```ts
type TransferImportPreview = {
  exportMode: TransferExportMode;
  organizationId: string;
  fileSize: number;
  inspectionCount: number;
  revisionCount: number;
  activityCount: number;
  evidenceCount: number;
  evidenceBytes: number;
  outboxCount: number;
};

type TransferImportPlan = TransferImportPreview & {
  importedCount: number;
  skippedCount: number;
  conflictCount: number;
  duplicateEvidenceCount: number;
};

type TransferMergeResult = TransferImportPlan & {
  completedAt: string;
};

function makeBundle(changes: Record<string, unknown> = {}): TransferBundle {
  return {
    format: 'pelp-pal-transfer', schemaVersion: 1, exportMode: 'pending',
    exportedAt: '2026-10-12T08:00:00.000Z', appVersion: '0.1.0',
    organizationId: 'org-1', sourceAccountId: 'account-source',
    records: { inspections: [], revisions: [], activities: [], evidence: [], evidenceBlobs: [], outbox: [] },
    ...changes,
  } as TransferBundle;
}

function jsonFile(value: unknown, name = 'recovery.pelp.json'): File {
  const text = JSON.stringify(value);
  return new File([text], name, { type: 'application/json' });
}
```

- [ ] **Step 1: Write failing codec tests**

Cover these cases in `tests/unit/transfer/transfer-codec.test.ts`:

```ts
it('round-trips a pending bundle with Unicode and evidence bytes', async () => {
  const bundle = makeBundle({ storeName: 'ร้านค้า 東京', evidenceBytes: [0xff, 0xd8, 0xff, 0xe0] });
  const file = await serializeTransferBundle(bundle);
  const parsed = await parseTransferFile(file);
  expect(parsed.records.inspections[0].storeName).toBe('ร้านค้า 東京');
  expect(await decodeEvidenceBlob(parsed.records.evidenceBlobs[0])).toEqual(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  );
});

it.each([
  ['wrong format', { format: 'other' }],
  ['unsupported version', { schemaVersion: 999 }],
  ['missing inspection id', { records: { inspections: [{ status: 'completed' }] } }],
])('rejects %s before import', async (_name, changes) => {
  await expect(parseTransferFile(jsonFile(makeBundle(changes)))).rejects.toThrow();
});

it('rejects invalid base64 and mismatched evidence checksums', async () => {
  await expect(parseTransferFile(jsonFile(makeBundle({ evidenceBase64: '!' })))).rejects.toThrow(/base64/i);
  await expect(parseTransferFile(jsonFile(makeBundle({ evidenceSha256: '0'.repeat(64) })))).rejects.toThrow(/checksum/i);
});

it('does not serialize cursors or credentials', async () => {
  const text = await (await serializeTransferBundle(makeBundle())).text();
  expect(text).not.toMatch(/access_token|refresh_token|password|change_cursor|cursor/i);
});
```

Use deterministic fixtures with stable IDs, one revision, one activity, one pending outbox row, and one JPEG-like byte array. Assert invalid JSON, arrays in place of objects, duplicate IDs, malformed timestamps, invalid counts, unsupported export modes, and oversized evidence are rejected with actionable messages.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-codec.test.ts
```

Expected: FAIL because the transfer types and codec do not exist yet.

- [ ] **Step 3: Implement the typed envelope and runtime parser**

Define the envelope with these fields:

```ts
export type TransferExportMode = 'pending' | 'full' | 'records';

export type TransferBundle = {
  format: 'pelp-pal-transfer';
  schemaVersion: 1;
  exportMode: TransferExportMode;
  exportedAt: string;
  appVersion: string;
  organizationId: string;
  sourceAccountId?: string;
  records: {
    inspections: Record<string, unknown>[];
    revisions: Record<string, unknown>[];
    activities: Record<string, unknown>[];
    evidence: Record<string, unknown>[];
    evidenceBlobs: TransferEvidenceBlob[];
    outbox: Record<string, unknown>[];
  };
};

export type TransferEvidenceBlob = {
  id: string;
  evidenceId: string;
  fileName: string;
  mimeType: string;
  size: number;
  base64: string;
  sha256?: string;
};
```

`serializeTransferBundle` must stringify only validated records, return a `File` named with the `.pelp.json` suffix and MIME type `application/json`, and preserve Unicode. `parseTransferFile` must read UTF-8 bytes, parse JSON, validate every required field and collection entry, reject unsupported format/version, validate padded base64 and byte lengths, and verify SHA-256 when supplied. Do not accept cursor records or credential-shaped fields in the exported collections.

Use `crypto.subtle.digest('SHA-256', bytes.buffer)` for checksums and avoid adding a dependency. Before serializing any local row, strip `accountScopeKey`, `change_cursor`, `changeCursor`, and cursor state objects from top-level and nested outbox payloads; the importer recreates local `change_cursor: 0` values and never receives remote cursor positions. Keep browser-only `File`/`Blob` operations behind functions that the Vitest jsdom environment can exercise.

- [ ] **Step 4: Run codec tests and typecheck**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-codec.test.ts
npm run typecheck
```

Expected: all codec tests pass and TypeScript reports no transfer contract errors.

---

### Task 2: Add account-scoped repository export and transactional merge

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/db/records.ts` only if a shared transfer-facing record type is required
- Create: `tests/unit/transfer/repository-transfer.test.ts`
- Reference: `src/lib/db/database.ts`, `src/lib/db/repository.ts`, `src/lib/supabase/remote-source.ts`

**Interfaces:**
- Consumes: `TransferBundle`, active `AccountScope`, current Dexie tables, and the codec’s validated evidence entries.
- Produces: `exportTransferBundle(mode: TransferExportMode): Promise<TransferBundle>`, `previewTransferMerge(bundle: TransferBundle): Promise<TransferImportPlan>`, and `mergeTransferBundle(bundle: TransferBundle): Promise<TransferMergeResult>`.

The repository test helper must seed the exact local shape used by production:

```ts
async function seedScopedInspectionAndOutbox(
  database: PELPPalDatabase,
  accountScopeKey: string,
  inspectionId: string,
  status: OutboxRecord['status'],
): Promise<void> {
  const now = '2026-10-12T08:00:00.000Z';
  const revision = { id: `${inspectionId}:revision:1`, inspection_id: inspectionId, revision: 1, change_cursor: 0, payload: { id: inspectionId, status: 'completed' }, accountScopeKey };
  await database.inspections.put({ id: inspectionId, status: 'completed', updatedAt: now, accountScopeKey });
  await database.inspectionRevisions.put({ ...revision, change_cursor: 0 });
  await database.outbox.put({ id: `${inspectionId}:outbox`, aggregateId: inspectionId, kind: 'inspection', payload: { inspection_id: inspectionId, revisions: [revision], events: [] }, status, nextAttemptAt: now, accountScopeKey });
}
```

- [ ] **Step 1: Write repository export and merge tests first**

Use a fresh `PELPPalDatabase` per test and call `repository.setAccountScope({ accountId: 'account-current', organizationId: 'org-1', key: 'org-1:account-current' })`.

Assert that:

```ts
it('exports only pending work for the active account and omits cursor state', async () => {
  await seedScopedInspectionAndOutbox(database, 'org-1:account-current', 'inspection-a', 'pending');
  await seedScopedInspectionAndOutbox(database, 'org-1:other-account', 'inspection-b', 'pending');
  const bundle = await repository.exportTransferBundle('pending');
  expect(bundle.organizationId).toBe('org-1');
  expect(bundle.records.inspections.map((row) => row.id)).toEqual(['inspection-a']);
  expect(JSON.stringify(bundle)).not.toMatch(/change_cursor|syncCursors|access_token|password/i);
});

it('previews an organization mismatch without changing IndexedDB', async () => {
  const bundle = makeBundle({ organizationId: 'org-2' });
  await expect(repository.previewTransferMerge(bundle)).rejects.toThrow(/organization/i);
  expect(await database.inspections.count()).toBe(0);
});

it('merges newer records, creates current-account outbox work, and is idempotent', async () => {
  const bundle = makeBundle({ organizationId: 'org-1', sourceAccountId: 'account-other' });
  const first = await repository.mergeTransferBundle(bundle);
  const second = await repository.mergeTransferBundle(bundle);
  expect(first.importedCount).toBeGreaterThan(0);
  expect(second.importedCount).toBe(0);
  expect(await database.outbox.where('accountScopeKey').equals('org-1:account-current').count()).toBe(1);
});
```

Add cases for older revisions being skipped, divergent same-ID revisions creating an open conflict without overwriting the local record, matching evidence checksums being skipped, differing checksums being preserved as a conflict, and imported deletions never deleting an inspection.

- [ ] **Step 2: Run the focused repository tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/transfer/repository-transfer.test.ts
```

Expected: FAIL because the repository transfer methods do not exist.

- [ ] **Step 3: Implement scoped export**

Read only records whose `accountScopeKey` matches the active scope. For `pending`, include due or retryable outbox rows plus their related inspection, revisions, activities, evidence metadata, and local evidence blobs. For `full`, include every active-scope inspection, revision, activity, evidence item, local evidence blob, and outbox row. For `records`, include the same records without `evidenceBlobs` and set `exportMode: 'records'`.

Convert each local `Blob` to a `TransferEvidenceBlob` containing `id`, `evidenceId`, `fileName`, `mimeType`, `size`, padded base64, and SHA-256. Copy `sourceAccountId` only as audit metadata; it must never control import authorization. Do not include `syncCursors`, server cursor fields, session data, account passwords, or remote tokens.

- [ ] **Step 4: Implement merge planning and transaction**

`previewTransferMerge` must validate `bundle.organizationId === activeScope.organizationId`, calculate imported/skipped/conflict/evidence counts, and return a plan without writing. `mergeTransferBundle` must revalidate the same condition and apply the plan inside one read/write Dexie transaction covering inspections, revisions, activity, evidence, evidence blobs, conflicts, tombstones, and outbox.

Use these exact decisions:

```ts
if (sameIdAndSameRevisionContent) skip();
else if (importedRevision > localRevision) applyImportedRevision();
else if (importedRevision < localRevision) recordSkippedOlderRevision();
else createOpenConflictAndKeepLocal();
```

Re-scope imported local records to the current `accountScopeKey` while preserving original inspector and audit fields inside the record payload. Reconcile outbox rows by stable ID and aggregate ID; imported pending work gets `status: 'pending'`, `nextAttemptAt: now`, `attempts: 0`, and the current scope key. Never copy imported cursor state or mark an imported row as synced. Restore evidence bytes as `Blob` objects only after checksum and size validation. If a merge conflict is created, retain both safe payloads in the conflict row using the existing conflict storage shape.

- [ ] **Step 5: Run repository tests and verify idempotency**

Run:

```powershell
npx vitest run tests/unit/transfer/repository-transfer.test.ts tests/unit/db/repository.test.ts
npm run typecheck
```

Expected: all transfer and repository tests pass; repeated imports do not increase inspection, evidence, activity, conflict, or outbox counts.

---

### Task 3: Implement portable file delivery and receiving helpers

**Files:**
- Create: `src/lib/transfer/transfer-file.ts`
- Create: `tests/unit/transfer/transfer-file.test.ts`

**Interfaces:**
- Consumes: a validated `File` from Task 1 and browser capability APIs.
- Produces: `downloadTransferFile(file): void`, `shareTransferFile(file): Promise<TransferDeliveryResult>`, `receiveTransferFile(file): Promise<TransferBundle>`, and `TransferDeliveryResult` with `shared`, `downloaded`, `canceled`, or `failed` outcomes.

- [ ] **Step 1: Write browser capability tests**

Mock `navigator.canShare`, `navigator.share`, `URL.createObjectURL`, `URL.revokeObjectURL`, and an anchor element. Assert:

```ts
it('uses Web Share only when file sharing is supported', async () => {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  Object.defineProperty(navigator, 'share', { value: vi.fn().mockResolvedValue(undefined), configurable: true });
  await expect(shareTransferFile(file)).resolves.toMatchObject({ status: 'shared' });
  expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ files: [file] }));
});

it('falls back to download when sharing is unsupported or rejected', async () => {
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => false), configurable: true });
  await expect(shareTransferFile(file)).resolves.toMatchObject({ status: 'downloaded' });
  Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
  Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new Error('blocked')), configurable: true });
  await expect(shareTransferFile(file)).resolves.toMatchObject({ status: 'downloaded' });
});
```

Also cover `AbortError` as a recoverable `canceled` result without forced download, a non-abort share rejection falling back to download, a `.pelp.json` download name, and receiving files with either `.json` or `.pelp.json` names and `application/json` or empty browser-reported MIME types.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-file.test.ts
```

Expected: FAIL because the delivery helpers do not exist.

- [ ] **Step 3: Implement standards-based delivery**

`shareTransferFile` must first test `navigator.canShare({ files: [file] })`, then call `navigator.share({ files: [file], title: 'PELP Pal recovery data', text: 'PELP Pal inspection recovery file' })`. It must not treat the share sheet opening as proof of delivery. On unsupported or non-abort rejection, use the normal anchor/object-URL download path and return `downloaded`; on `AbortError`, return `canceled` while retaining the file for another attempt. Keep the same file bytes and filename for iOS, Android, desktop, and installed PWA paths.

`receiveTransferFile` must pass the selected file to `parseTransferFile`; it must not use clipboard text, URL parameters, data URLs, or platform-specific encodings. Use an explicit file-size limit for preview warnings, but do not silently truncate the file.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-file.test.ts
```

Expected: PASS for share, download, rejection fallback, cancellation, and file receiving behavior.

---

### Task 4: Add Sync-screen export/import preview and merge UI

**Files:**
- Create: `src/features/sync/transfer-recovery-panel.tsx`
- Modify: `src/features/sync/sync-view.tsx`
- Modify: `tests/unit/sync/sync-view.test.tsx`
- Create: `tests/unit/transfer/transfer-recovery-panel.test.tsx`

**Interfaces:**
- Consumes: repository methods from Task 2, file helpers from Task 3, and the existing `SyncStatusStore`.
- Produces: accessible Sync actions named `Export recovery JSON`, `Share recovery JSON`, and `Import and merge JSON`, with preview/confirmation and outcome states.

- [ ] **Step 1: Write component tests**

Mock the repository and status store. Assert that:

```ts
it('previews an import before calling merge', async () => {
  render(<TransferRecoveryPanel repository={repository} statusStore={statusStore} />);
  await user.upload(screen.getByLabelText(/import and merge json/i), transferFile);
  expect(await screen.findByText(/review import/i)).toBeInTheDocument();
  expect(repository.mergeTransferBundle).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /merge imported data/i }));
  expect(repository.mergeTransferBundle).toHaveBeenCalledTimes(1);
});

it('leaves the database unchanged when the preview is canceled', async () => {
  await user.upload(importInput, transferFile);
  await user.click(await screen.findByRole('button', { name: /cancel/i }));
  expect(repository.mergeTransferBundle).not.toHaveBeenCalled();
});
```

Cover export mode selection, full versus records-only warning, evidence count, file size, organization mismatch, invalid JSON, merge success, merge conflicts, share/download feedback, mobile-width layout, and calling `statusStore.syncNow('manual', 'upload')` after a successful merge.

- [ ] **Step 2: Run focused UI tests and verify they fail**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-recovery-panel.test.tsx tests/unit/sync/sync-view.test.tsx
```

Expected: FAIL because the recovery panel and Sync actions do not exist.

- [ ] **Step 3: Implement the recovery panel**

Add the panel below the existing Sync actions. Use MUI `Paper`, `Stack`, `Button`, `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`, `Alert`, `Chip`, and a visually hidden `<input type="file" accept=".json,application/json">`.

The panel must:

1. export pending work by default;
2. offer full and records-only modes, with a warning for embedded evidence size;
3. create a `.pelp.json` file and call download/share helpers;
4. parse a selected file and show organization, mode, file size, inspections, revisions, activities, evidence, and outbox counts before mutation;
5. require explicit confirmation before `mergeTransferBundle`;
6. show imported/skipped/conflict/evidence counts after merge;
7. explain that imported work is queued for normal upload;
8. trigger the existing upload operation after a successful merge;
9. keep the selected file until confirm or cancel and reset the input after completion so the same file can be selected again;
10. show actionable errors without exposing bundle payloads, tokens, or credentials.

Use responsive MUI sizing so the three actions stack on small screens and remain usable at iOS/Android mobile widths.

- [ ] **Step 4: Run UI tests and typecheck**

Run:

```powershell
npx vitest run tests/unit/transfer/transfer-recovery-panel.test.tsx tests/unit/sync/sync-view.test.tsx
npm run typecheck
```

Expected: PASS with no new TypeScript errors.

---

### Task 5: Expose transfer and sync diagnostics without sensitive data

**Files:**
- Modify: `src/lib/db/repository.ts`
- Modify: `src/lib/sync/coordinator.ts`
- Modify: `src/lib/sync/runtime.ts`
- Modify: `src/features/sync/sync-status-store.ts`
- Modify: `src/features/sync/sync-view.tsx`
- Modify: `src/components/app-shell/app-shell.tsx` only if the compact mobile/desktop shell indicator needs the same realtime/polling label
- Modify: `tests/unit/sync/coordinator.test.ts`
- Modify: `tests/unit/sync/sync-status-store.test.ts`
- Modify: `tests/unit/sync/sync-view.test.tsx`

**Interfaces:**
- Consumes: existing local outbox/cursor state and Task 2 transfer results.
- Produces: a safe `SyncDiagnostics` snapshot with local, pending, retry, failed, conflict, upload/download, realtime/polling, account, organization, and last transfer status fields.

- [ ] **Step 1: Add failing diagnostics assertions**

Extend the existing sync tests to assert that the UI can show:

```ts
expect(screen.getByText(/pending/i)).toBeInTheDocument();
expect(screen.getByText(/local inspections/i)).toBeInTheDocument();
expect(screen.getByText(/organization/i)).toBeInTheDocument();
expect(screen.queryByText(/access_token|refresh_token|password/i)).not.toBeInTheDocument();
```

Add repository/coordinator fixtures for pending, retrying, failed, conflict, local count, remote count, last upload, last download, and last transfer outcome. Assert diagnostics refresh after an import merge and after sync completion.

- [ ] **Step 2: Implement the diagnostics snapshot**

Keep the existing `SyncStatusSnapshot` shape compatible and add optional fields rather than changing existing consumers. Use repository methods to count active-scope outbox statuses and completed inspections. Store only timestamps, counts, safe error messages, transfer result status, and account/organization identifiers. Do not include raw outbox payloads, cursors, session tokens, or evidence bytes. Add `pollingActive?: boolean` to the snapshot and have the runtime set it while its 45-second visible/online fallback is installed; clear it from `stop()`. The UI may show `Polling` only when `pollingActive` is true and the browser is online.

Keep the existing realtime channel state and polling fallback labels. If realtime is disconnected while the visible runtime polling interval is active, display `Polling`; if realtime is reconnecting, display `Reconnecting`; display `Live` only for a connected channel.

- [ ] **Step 3: Run focused diagnostics tests**

Run:

```powershell
npx vitest run tests/unit/sync/coordinator.test.ts tests/unit/sync/sync-status-store.test.ts tests/unit/sync/sync-view.test.tsx
```

Expected: PASS with existing realtime-state behavior preserved.

---

### Task 6: Add browser-level recovery and cross-platform compatibility coverage

**Files:**
- Modify: `tests/e2e/responsive.spec.ts` only if shared mobile helpers are useful
- Create: `tests/e2e/transfer-recovery.spec.ts`
- Modify: `playwright.config.ts` only if the new test needs a separate opt-in project
- Reference: `tests/e2e/auth-fixtures.ts`, `tests/e2e/two-device-sync.spec.ts`

**Interfaces:**
- Consumes: the Sync screen, browser repository, and existing Playwright auth fixtures.
- Produces: browser evidence that export/import works at desktop, iOS-like, and Android-like viewport sizes.

- [ ] **Step 1: Write the guarded Playwright scenarios**

Use `E2E_SUPABASE=1` for live authenticated scenarios and skip with a clear reason otherwise. Cover:

```ts
test('exports and re-imports a recovery bundle without duplicate activity', async ({ page }) => {
  test.skip(process.env.E2E_SUPABASE !== '1', 'Requires a live Supabase test account and disposable organization.');
  // authenticate with the existing fixture, open /sync, export, select the file in a second context, preview, and merge
  // assert the import result and unchanged duplicate count after importing the same file twice
});
```

Mock `navigator.canShare` and `navigator.share` in separate contexts to represent an iOS-like file share and Android-like Quick Share path. Assert both use the same `.pelp.json` bytes and that disabling file sharing uses download plus file selection. Use `devices['iPhone 13']` and `devices['Pixel 7']` from the existing Playwright config.

- [ ] **Step 2: Run browser tests in non-live mode**

Run:

```powershell
npx playwright test tests/e2e/transfer-recovery.spec.ts
```

Expected: local capability/UI scenarios pass; live Supabase scenarios are explicitly skipped when `E2E_SUPABASE` is absent.

- [ ] **Step 3: Run live disposable-account coverage when credentials are available**

Run:

```powershell
$env:E2E_SUPABASE = '1'
npx playwright test tests/e2e/transfer-recovery.spec.ts --project="iPhone 13" --project="Pixel 7"
```

Expected: both mobile-like contexts import the same file format, merge once, and show the imported work as pending until the existing sync operation completes. Do not use production accounts or production inspection data for this test.

---

### Task 7: Validate the integrated web-primary workflow and document operator recovery

**Files:**
- Modify: `docs/superpowers/specs/2026-10-12-web-primary-transfer-recovery-design.md` only for verified implementation notes
- Create: `docs/web-primary-recovery.md`
- Modify: `README.md` only if the project currently documents sync usage there

**Interfaces:**
- Consumes: completed transfer, repository, UI, diagnostics, and browser tests from Tasks 1–6.
- Produces: operator instructions for exporting, sharing, importing, reviewing conflicts, and resuming normal sync.

- [ ] **Step 1: Write the operator recovery instructions**

Document these exact flows:

1. On the source browser, open Sync and export pending recovery JSON.
2. Use Share recovery JSON when iOS/Android offers file sharing; use Download recovery JSON otherwise.
3. Transfer through AirDrop, Quick Share, Files, Downloads, or ordinary file attachment.
4. On the receiving browser, choose Import and merge JSON, review counts and organization, then confirm.
5. Run Force upload inspections and confirm the pending count decreases.
6. Review conflicts instead of deleting local records.

State that the `.pelp.json` file is sensitive inspection data even though it contains no credentials, and should be transferred only through approved channels.

- [ ] **Step 2: Run all required checks**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test tests/e2e/transfer-recovery.spec.ts
git diff --check
```

Expected: lint, typecheck, unit tests, and build pass; Playwright capability tests pass and live tests either pass with disposable credentials or skip with their explicit reason. Verify the existing Activity pagination changes are still present and no unrelated files are staged.

- [ ] **Step 3: Perform manual device verification**

On iOS Safari and Android Chrome, verify:

- export produces a `.pelp.json` file;
- native share opens when file sharing is supported;
- AirDrop/Quick Share/Files can deliver the file;
- import opens the preview before any local mutation;
- cancel leaves Activity unchanged;
- repeated import is idempotent;
- imported work is visibly pending and uploads through the existing Sync buttons.

Do not claim cross-platform delivery is verified until both device families and the desktop download fallback have been exercised.

