# PELP Pal Web Sync and EMV Report

## Status

Approved design for implementation planning. This specification is not committed automatically.

## Goal

Connect the existing local-first synchronization coordinator to the authenticated workspace and add a Report tab that lets EMV users enter report details, calculates the report from completed inspections, and downloads a populated copy of `public/EMV Report Sample.docx`.

## Scope

This work has two ordered phases:

1. Make sync visible and usable from the Sync page.
2. Add a Report route and navigation item backed by synchronized local inspection data.

Supabase remains the authoritative remote system. IndexedDB remains authoritative for active browser work while offline. The report is a local presentation/export of inspection data; it is not a new remote aggregate or a web-only synchronization protocol.

## Existing contract

The web client already contains:

- `SyncCoordinator` with single-flight pulls, outbox delivery, retry state, and cursor recovery.
- `SupabaseSyncRemote` using the existing `pull_sync_changes`, `push_activity_events`, and `push_inspection_revisions` RPCs.
- Realtime routing that schedules a cursor pull rather than mutating local data from raw events.
- IndexedDB stores for inspections, activity, drafts, evidence, outbox, conflicts, and cursors.
- The supplied Word template at `public/EMV Report Sample.docx`.

The current gap is that the workspace does not bootstrap one shared sync coordinator and the Sync page only displays enrollment status.

## Phase 1 Sync

### Bootstrap

Create one client-side sync bootstrap at the workspace boundary. It will:

- Obtain the existing browser Supabase client and local repository.
- Construct one `SupabaseSyncRemote` and one `SyncCoordinator` for the browser session.
- Start Realtime subscriptions only for an enrolled, authorized browser.
- Stop subscriptions when enrollment or authorization becomes invalid.
- Trigger sync for startup, browser resume, `online`, manual retry, and Realtime events.
- Keep a single active sync promise so multiple triggers cannot drain the same outbox concurrently.

No page will create its own coordinator or direct remote inspection query.

### Inspection delivery

Completing an inspection will save the completed inspection, activity event, and inspection outbox payload in one local transaction. The outbox payload will contain the stable inspection ID, revision/event data, and the fields required by the existing RPC contract. Evidence metadata will remain associated with the inspection and must be available before a remote revision is acknowledged.

The implementation must not expose service-role or secret keys and must not add a second Supabase migration history.

### Local reconciliation

Pulled inspection revisions will be applied to the local canonical inspection mirror transactionally with cursor advancement. Repeated pages and retries must be idempotent. Conflicts remain visible and terminal until the existing conflict-resolution flow resolves them.

Summary and Report read the local mirror after reconciliation. They never maintain synchronized aggregate counters.

### Sync UI

The Sync page will show:

- Live status: `Live`, `Syncing`, `Pending`, `Offline`, `Reconnecting`, or `Error`.
- Last successful sync time.
- Pending/retrying outbox count.
- Open conflict count.
- A `Sync now` action.
- Retry and useful error text when a sync fails.
- Enrollment/authorization state.

The UI will retain useful local data during failures and will not imply remote success before the server acknowledges the operation.

## Phase 2 Report

### Navigation and route

Add `Report` after `Summary` in the desktop navigation, mobile drawer, and any responsive navigation surface. Add `/report` under the authenticated workspace layout.

### Report draft

Report header details are local draft data keyed by finished store. The draft will use the existing IndexedDB approach and will contain:

- Inspection date.
- Region/province.
- DOE Monitoring Team.
- Distributor/dealer type.
- Store name, address, email, contact number, and store representative.
- Findings/observations.
- Recommendations/resolution.
- Team leader, acknowledged-by name, and designations.

Draft changes autosave locally and survive reload/offline use. These report header fields are not remotely synchronized until the backend contract defines a report entity and authorized report RPCs.

### Report data

The selected finished store determines the report scope. The default view may show all finished stores, with a finished-store filter matching Summary.

Completed inspections are consolidated by store and control number. A repeated model/control result is treated as non-compliant when any inspection for that product contains an NC finding. The same inspector receives an already-inspected notification before beginning another inspection; different inspectors may inspect the same product.

The report calculates:

- Compliant models.
- Non-compliant models.
- Labeled models.
- Exempted models.
- Model count.
- Compliance rate with safe `N/A` behavior for zero models.
- Annex A non-compliance rows sorted with NC products first.

When multiple inspections report the same NC category for one product, the consolidated report counts that product once for that category. The inspection history remains available in Activity.

### Word template population

The original `public/EMV Report Sample.docx` remains unchanged and is treated as the layout authority. The template inventory currently identifies:

- A Monitoring and Enforcement Summary table with ECP type rows, totals, and compliance rate.
- An Annex A table with No., ECP Type, Brand Name, Model Code, and Description of Non-Compliance columns.
- Text slots for inspection date, location/team, store background, findings, recommendations, and signatures/designations.
- Notice and conformity sections that remain preserved.

The browser will fetch the retained template, patch only documented text/table slots in the DOCX package, and download a new file. The untouched template file and preserve-only package parts must remain unchanged. The generated file name will include the store and inspection date.

The generated report must preserve the template's page geometry, existing styles, table structure, notice text, signature sections, and other package relationships. Export QA will render the generated DOCX and visually inspect every page before the feature is considered complete.

## Error and empty states

- Sync errors remain visible with retry and preserved local data.
- Report tables always render, including zero-filled ECP rows and `N/A` rates.
- Missing catalog company/email fields display `Not available`; no values are invented.
- Missing or invalid template data produces an actionable export error without deleting the local report draft.
- A report with no NC items still contains the Annex A header and an explicit no-results row in the web preview; the Word template's existing empty rows remain preserved where possible.

## Testing

Add or update tests for:

- Shared sync bootstrap and single-flight behavior.
- Startup/manual/online/Realtime sync triggers.
- Outbox creation when an inspection is completed.
- Cursor and inspection reconciliation on pulled revisions.
- Retry/error state preservation.
- Report draft reload and finished-store filtering.
- Zero-filled report tables and safe compliance percentages.
- Product consolidation and NC-priority sorting.
- Same-inspector duplicate notification.
- Template slot replacement and untouched template preservation.
- DOCX export render and visual fidelity.
- Responsive navigation and Report route access.

Verification gates:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Live Supabase verification remains a separate gate requiring an enrolled test account and must not be claimed from local unit/build checks alone.
