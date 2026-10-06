# PELP Pal Catalog Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Add a secure administrator-only Upload → Review → Publish workflow for masterlist.json that updates the shared PELP Pal catalog without exposing service credentials or replacing a device’s local catalog with partial data.

**Architecture:** The PELP Pal V2 repository owns the Supabase migration, Storage policies, manifest publication transaction, and protected catalog-publish Edge Function. This web repository owns local JSON inspection, the responsive Account UI, signed Storage upload orchestration, and catalog refresh. The backend is completed and verified first; the web client then consumes the exact function contract.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI v7, Supabase JS, Supabase Edge Functions/Deno, Supabase Storage, PostgreSQL/RLS, pgTAP, Vitest, and Playwright.

**Spec:** docs/superpowers/specs/2026-10-06-pelp-pal-catalog-publishing-design.md

## Global Constraints

- Use **Upload → Review → Publish**; selecting a file never publishes it automatically.
- Keep service-role and secret keys out of browser code and out of every \`NEXT_PUBLIC_\` variable.
- The shared Supabase migration and Edge Function belong to \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\`; the web repository must not create a second catalog schema or sync protocol.
- Preserve the existing \`catalog_manifests\` response shape: \`catalog_role\`, \`version\`, \`integrity_hash\`, \`row_count\`, \`schema_version\`, and \`storage_path\`.
- Validate the current approximately 50 MB, 12,817-row masterlist without sending the file through a server action or ordinary Edge Function request body.
- Upload to a temporary object, verify it, then overwrite one fixed published object to stay within the free Storage plan. Keep an external backup before production publication because the previous Storage object will not be retained.
- Enforce administrator authorization on the backend using the active account and organization context; UI visibility is not authorization.
- Run Supabase security and performance advisors after the backend migration.
- Do not deploy or mutate the development or production Supabase project during implementation without a separate explicit deployment approval.

---

## File and Boundary Map

### PELP Pal V2 backend repository

- Create: \`supabase/functions/catalog-publish/index.ts\`
  - Authenticated \`initiate\` and \`finalize\` actions.
  - Signed Storage upload creation.
  - Server-side object validation.
- Create: the migration file printed by \`supabase migration new catalog_publish_access\`
  - Private catalog Storage configuration and scoped read policy.
  - \`publish_catalog_manifest\` transaction function and grants.
- Create: \`supabase/tests/catalog_publishing.sql\`
  - Schema, policy, function, and authorization contract tests.
- Modify: generated Supabase types if the repository’s established type-generation workflow includes the new function.

### PELP Pal Web repository

- Create: \`src/features/catalog/catalog-publish-validation.ts\`
  - Browser-side JSON inspection, duplicate detection, product-type summary, and SHA-256 metadata.
- Create: \`src/features/catalog/catalog-publish-client.ts\`
  - Typed calls to the Edge Function and signed Storage upload.
- Create: \`tests/unit/catalog-publish-validation.test.ts\`
- Create: \`tests/unit/catalog-publish-client.test.ts\`
- Create: \`src/features/account/catalog-management-panel.tsx\`
  - Admin-only responsive Account card and Upload → Review → Publish state machine.
- Modify: \`src/features/account/account-view.tsx\`
  - Render catalog management only for an active administrator.
- Modify: \`tests/unit/account.test.tsx\`
  - Admin visibility and non-admin hiding behavior.
- Create or modify: \`tests/e2e/catalog-publishing.spec.ts\`
  - Staging smoke path with the backend call mocked or test-gated; never publish to production from an automated browser test.

---

### Task 1: Establish the backend preflight and migration contract

**Files:**
- Create: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase\\tests\\catalog_publishing.sql\`
- Create: the generated migration path from \`supabase migration new catalog_publish_access\`

**Interfaces:**
- Produces \`public.publish_catalog_manifest(text, text, text, integer, integer) -> jsonb\`.
- Produces the private catalog Storage policy contract consumed by the existing web \`catalog-sync.ts\`.
- Produces pgTAP assertions that later Edge Function work must satisfy.

- [ ] **Step 1: Inspect the linked repository and live schema before writing DDL**

Run from \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\`:

\`\`\`powershell
supabase --version
supabase migration list --linked
supabase migration new catalog_publish_access
\`\`\`

Record the generated migration path. Before changing it, inspect the current production and development values for:

\`\`\`sql
select organization_id, catalog_role, version, storage_path, row_count
from public.catalog_manifests
order by organization_id, catalog_role;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'catalogs';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'catalog_manifests';
\`\`\`

Expected result: identify whether each organization has one current manifest and whether the existing public object path needs a compatibility copy before the bucket becomes private.

- [ ] **Step 2: Write the failing pgTAP contract test**

Add assertions to \`supabase/tests/catalog_publishing.sql\` for:

\`\`\`sql
SELECT plan(12);

SELECT ok(
  to_regprocedure('public.publish_catalog_manifest(text,text,text,integer,integer)') IS NOT NULL,
  'catalog manifest publication function exists'
);

SELECT has_table('storage', 'objects', 'Storage objects remain available');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'catalogs' AND public = false
  ),
  'catalog bucket is private'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can read scoped catalogs'
  ),
  'catalog read policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Catalogs are not directly writable by clients'
  ),
  'catalog direct-write protection exists'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.publish_catalog_manifest(text,text,text,integer,integer)',
    'EXECUTE'
  ),
  'authenticated role can reach the authorization-checked publication function'
);
\`\`\`

Add the remaining six assertions for the unique current-manifest invariant, function result fields, revocation/inactive denial, cross-organization denial, and non-admin denial. Run:

\`\`\`powershell
supabase test db --linked
\`\`\`

Expected result: the new function and policy assertions fail before the migration exists.

- [ ] **Step 3: Add the migration with private, scoped catalog access**

In the generated migration:

1. Set the \`catalogs\` bucket to private and enforce JSON upload limits suitable for the current file size.
2. Add a Storage SELECT policy named \`Users can read scoped catalogs\` that permits an authenticated caller to read only:
   - its organization’s path prefix;
   - the catalog role allowed by its active account/device scope;
   - published catalog paths, not \`incoming\` paths.
3. Do not add client INSERT, UPDATE, or DELETE policies for the catalog bucket.
4. Add a preflight-safe unique index for one current manifest per organization and catalog role only after asserting no duplicates exist.
5. Add \`public.publish_catalog_manifest\` as an authorization-checked function that:
   - resolves the active account using the existing account contract;
   - rejects non-admin, inactive, revoked, and cross-organization callers;
   - locks the current manifest row;
   - increments the version or starts at version 1;
   - updates the single current manifest;
   - returns the complete manifest fields required by \`catalog-sync.ts\`.
6. Revoke execution from \`PUBLIC\` and grant execution only to \`authenticated\`.
7. Keep existing published objects untouched until the compatibility copy and read-path verification are complete.

- [ ] **Step 4: Run the backend contract test and advisors**

Run from \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\`:

\`\`\`powershell
supabase test db --linked
supabase db advisors
supabase migration list --linked
\`\`\`

Expected result: the catalog contract tests pass, advisors report no new catalog security issue, and the migration appears exactly once. Do not apply this migration to the shared production project in this task.

- [ ] **Step 5: Commit the backend contract separately**

Review the migration, tests, generated types, and advisor output. Create a backend commit only after the repository owner explicitly approves the database/backend commit.

---

### Task 2: Implement the protected catalog-publish Edge Function

**Files:**
- Create: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase\\functions\\catalog-publish\\index.ts\`
- Create or modify: the function’s \`deno.json\`/import-map file using the existing repository convention.
- Test: \`C:\\Users\\mklgr\\Codes\\pelp_pal_v2\\supabase\\tests\\catalog_publishing.sql\` plus the repository’s Edge Function test command.

**Interfaces:**
- Request body:
  \`{ action: 'initiate' | 'finalize'; catalog_role: 'masterlist'; ... }\`.
- Initiate response:
  \`{ upload_path: string; token: string }\`.
- Finalize response:
  \`{ catalog_role: 'masterlist'; version: number; row_count: number; integrity_hash: string; storage_path: string; published_at: string }\`.

- [ ] **Step 1: Write failing request-validation tests**

Cover these exact cases:

\`\`\`text
POST without a valid authenticated user -> 401
guest, EPRED, inactive, revoked, or cross-organization user -> 403
unknown action -> 400
catalog_role other than masterlist -> 400
file name other than masterlist.json -> 400
size above 100 MiB -> 400
finalize path outside the caller organization or incoming prefix -> 400
finalize with a missing object -> 400
finalize with wrong digest or row count -> 400
valid initiate -> signed upload target
valid finalize -> publication response
\`\`\`

- [ ] **Step 2: Implement initiate**

Use the authenticated bearer token to resolve the caller and the service-role client only inside the Edge Function. Verify active administrator status and organization. Generate an opaque upload ID, create an organization-scoped incoming path, and return a one-time Storage upload target. Never return the service-role key or a public catalog URL.

- [ ] **Step 3: Implement finalize**

Download the incoming object server-side, calculate SHA-256, parse the JSON array, validate each row has a non-empty string \`id\`, reject duplicates, require a string \`product_type\`, and verify the computed row count and schema version. Read the current object for transient rollback, upload the verified object with \`upsert: true\` to the fixed published path, then invoke \`publish_catalog_manifest\` through an authenticated user-scoped client. If validation or upload fails, leave the manifest untouched; if publication fails after replacement, restore the previous object before reporting the error, then retry and monitor the operation.

- [ ] **Step 4: Make finalize idempotent and storage-efficient**

Use the fixed published path `<organization-id>/masterlist/masterlist.json`. If the current manifest already has the same digest, row count, schema version, and fixed path, return the existing published manifest rather than incrementing the version twice. Upload the verified incoming object with `upsert: true`, then update the manifest. Remove only the temporary incoming object after successful publication; the previous published object is intentionally overwritten to control Storage usage.

- [ ] **Step 5: Deploy only to the development Supabase project and verify**

Deploy the function to the development project with JWT verification enabled. Run the request matrix against the development project using an admin, EPRED, guest, inactive, revoked, and cross-organization test identity. Do not deploy to the shared PELP Pal V2 project yet.

- [ ] **Step 6: Commit the backend function separately**

Review logs and authorization results. Create a backend function commit only after explicit approval for the backend deployment path.

---

### Task 3: Build the browser-side masterlist inspector

**Files:**
- Create: \`src/features/catalog/catalog-publish-validation.ts\`
- Test: \`tests/unit/catalog-publish-validation.test.ts\`

**Interfaces:**

\`\`\`ts
export type MasterlistInspection = {
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  duplicateIds: string[];
  productTypes: string[];
  sha256: string;
  schemaVersion: number;
};

export function inspectMasterlistFile(file: File): Promise<MasterlistInspection>;
\`\`\`

- [ ] **Step 1: Write failing validation tests**

Use small in-memory \`File\` fixtures to test:

\`\`\`text
valid rows -> row count, product types, schemaVersion 1, and SHA-256
non-array JSON -> actionable invalid-payload error
missing id -> row-index error
blank id -> row-index error
duplicate id -> duplicate-ID error with the duplicate value
missing product_type -> row-index error
unsupported source_version -> schema-version error
empty file -> invalid-payload error
\`\`\`

- [ ] **Step 2: Run the focused test and verify failure**

Run:

\`\`\`powershell
npm test -- --run tests/unit/catalog-publish-validation.test.ts
\`\`\`

Expected result: FAIL because \`inspectMasterlistFile\` does not exist.

- [ ] **Step 3: Implement bounded client validation**

Read the file once, parse the JSON array, validate required fields, calculate the product-type set and duplicate IDs, derive schema version 1 from the current masterlist row contract, and compute SHA-256 with \`crypto.subtle.digest('SHA-256', ...)\`. Enforce a 100 MiB client limit before parsing.

- [ ] **Step 4: Run the focused test and verify success**

Run the same command. Expected result: all validation tests pass.

- [ ] **Step 5: Commit the validation unit**

Commit only the validation utility and tests after the focused test passes.

---

### Task 4: Add the typed signed-upload client

**Files:**
- Create: \`src/features/catalog/catalog-publish-client.ts\`
- Test: \`tests/unit/catalog-publish-client.test.ts\`

**Interfaces:**

\`\`\`ts
export type CatalogPublishResult = {
  catalogRole: 'masterlist';
  version: number;
  rowCount: number;
  integrityHash: string;
  storagePath: string;
  publishedAt: string;
};

export async function publishMasterlist(
  file: File,
  inspection: MasterlistInspection,
  client?: SupabaseClient<Database>,
): Promise<CatalogPublishResult>;
\`\`\`

- [ ] **Step 1: Write failing client tests**

Mock the Supabase Functions and Storage APIs and assert:

\`\`\`text
initiate receives catalog_role, file name, row count, digest, and schema version
uploadToSignedUrl receives the exact returned path, token, and File
finalize receives the returned path and the same metadata
initiate errors stop before Storage upload
upload errors stop before finalize
finalize errors return the backend message
successful response maps snake_case fields to CatalogPublishResult
\`\`\`

- [ ] **Step 2: Run the focused test and verify failure**

Run:

\`\`\`powershell
npm test -- --run tests/unit/catalog-publish-client.test.ts
\`\`\`

Expected result: FAIL because \`publishMasterlist\` does not exist.

- [ ] **Step 3: Implement the client orchestration**

Use \`client.functions.invoke('catalog-publish', { body })\` for initiate and finalize. Use \`client.storage.from('catalogs').uploadToSignedUrl(uploadPath, token, file)\` for the 50 MB file. Convert backend errors into messages that identify whether initiation, upload, or finalization failed. Never call \`from('catalog_manifests').insert/update\` from the browser.

- [ ] **Step 4: Run the focused test and verify success**

Run the same command. Expected result: all client orchestration tests pass.

---

### Task 5: Add the responsive Account catalog management panel

**Files:**
- Create: \`src/features/account/catalog-management-panel.tsx\`
- Modify: \`src/features/account/account-view.tsx\`
- Modify: \`tests/unit/account.test.tsx\`

**Interfaces:**

\`\`\`tsx
export function CatalogManagementPanel({
  onPublished,
}: {
  onPublished?: (result: CatalogPublishResult) => void;
}): JSX.Element;
\`\`\`

- [ ] **Step 1: Extend Account tests with failing admin/non-admin cases**

Add tests that assert:

\`\`\`text
admin sees Catalog management
epred does not see the upload control
guest does not see the upload control
admin selecting invalid JSON sees validation feedback
admin sees review summary before Publish masterlist
Publish masterlist remains disabled until a successful upload exists
successful publish shows the new version and success message
\`\`\`

- [ ] **Step 2: Run the Account test and verify the new cases fail**

Run:

\`\`\`powershell
npm test -- --run tests/unit/account.test.tsx
\`\`\`

Expected result: existing Account tests pass and the new catalog-management assertions fail because the panel is not rendered.

- [ ] **Step 3: Implement the panel state machine**

Use these states:

\`\`\`text
idle
inspecting
review
uploading
publishing
success
error
\`\`\`

Render the panel only when the loaded device is enrolled, active, and assignedRole is \`admin\`. Use MUI responsive Stack/Paper/Alert/LinearProgress components and preserve the centralized theme. Do not show raw service credentials, upload tokens, or full JSON contents.

- [ ] **Step 4: Implement review and publish actions**

On file selection, call \`inspectMasterlistFile\` and render file size, row count, product types, duplicate count, and digest. On confirmation, call \`publishMasterlist\`, then call \`syncMasterlistCatalog\` for the current browser so the admin’s local Lookup catalog refreshes immediately. Invoke \`onPublished\` to refresh the Account manifest display.

- [ ] **Step 5: Run focused tests and verify success**

Run:

\`\`\`powershell
npm test -- --run tests/unit/account.test.tsx
\`\`\`

Expected result: all Account and catalog-management tests pass.

---

### Task 6: Add the staging end-to-end gate

**Files:**
- Create or modify: \`tests/e2e/catalog-publishing.spec.ts\`
- Modify: \`playwright.config.ts\` only if a dedicated staging test project is needed.

**Interfaces:**
- Uses a test-gated Edge Function mock for CI.
- Uses the real development Supabase project only in a manually invoked staging smoke run.

- [ ] **Step 1: Write the browser test against a mocked publish boundary**

Verify in a narrow mobile viewport that an admin can:

1. Open Account.
2. Select a valid fixture JSON.
3. See the review summary.
4. Click Publish masterlist.
5. See the success version.
6. See the catalog refresh message.

Verify EPRED and guest fixtures do not see the panel.

- [ ] **Step 2: Run the browser test**

Run:

\`\`\`powershell
npm run test:e2e -- tests/e2e/catalog-publishing.spec.ts
\`\`\`

Expected result: the workflow passes without contacting a production Supabase project.

- [ ] **Step 3: Run the manual staging smoke path**

With the development Vercel/local environment configured, upload the real \`public/masterlist.json\`, verify the manifest version increases exactly once, refresh Lookup on two enrolled devices, and confirm both devices have the same row count and digest.

- [ ] **Step 4: Verify failure safety**

Interrupt an upload and submit a tampered digest. Confirm the previous manifest remains active and the local catalog remains unchanged. Before a real publish, retain an external copy because the fixed Storage object is overwritten after verification.

---

### Task 7: Production rollout and handoff

**Files:**
- Modify: PELP Pal V2 migration/deployment records only through the approved backend deployment workflow.
- Modify: Vercel Production environment variables only through an explicit deployment approval.

- [ ] **Step 1: Run the full web verification suite**

Run from the web repository:

\`\`\`powershell
npm run typecheck
npm run lint
npm test -- --run
npm run build
npm run test:e2e
git diff --check
\`\`\`

Expected result: all commands pass with no environment files modified.

- [ ] **Step 2: Apply the reviewed backend migration and Edge Function to staging**

Use the Supabase migration/function deployment workflow against the development project. Run the backend authorization matrix and the staging smoke path again.

- [ ] **Step 3: Apply the reviewed backend migration and Edge Function to shared PELP Pal V2**

Before applying, verify the production manifest, current object path, bucket compatibility, and migration list. Do not overwrite or delete the existing production catalog object. Run security and performance advisors after deployment.

- [ ] **Step 4: Configure and redeploy the web client**

Keep Preview pointed to staging. Configure Production with the shared PELP Pal V2 project’s public URL and publishable/anon key. Redeploy and verify the Account panel, catalog publish, Lookup refresh, and existing Flutter sync behavior.

- [ ] **Step 5: Perform a read-only production verification**

Confirm the published manifest version, row count, and fixed storage path from an enrolled production browser. Do not publish a new production catalog until an external backup of the current masterlist and the recovery procedure have been approved.

- [ ] **Step 6: Create separate backend and web commits**

Commit the backend migration/function in \`pelp_pal_v2\` and the web implementation in \`pelp-pal-web\` separately, using reviewed conventional commit messages. Push only after explicit approval.
