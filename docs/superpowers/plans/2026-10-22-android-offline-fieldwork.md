# Android Offline Fieldwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a signed-in Android device online so catalog inspection and existing file exports work after a cold restart without internet.

**Architecture:** The production PWA becomes a Trusted Web Activity APK. A preparation step verifies account scope, catalog integrity, sync, public app assets, and the report template. Offline launches use a cached shell, a retained account scope, and a static inspection entry route; local Dexie remains the data source and the existing coordinator handles later sync.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Dexie, Supabase JS, service worker, Vitest, Playwright, Android Trusted Web Activity/Bubblewrap.

**Spec:** `docs/superpowers/specs/2026-10-22-android-offline-fieldwork-design.md`

## Global Constraints

- Initial sign-in and preparation occur online at DOE; no new offline credentials or server protocol.
- No authenticated API response, account HTML, inspection data, or evidence photo enters the service worker cache.
- Catalog readiness uses the assigned role, manifest version, row count, and existing integrity verification.
- Keep account-scoped writes isolated during offline startup and after account changes.
- The Word DOCX, Recovery JSON, and local evidence exports must produce usable files offline on Android.
- Preserve the user's uncommitted `next.config.ts` change; do not deploy, push, or commit without authorization.

---

### Task 1: Offline cache preparation

**Files:** Modify `public/sw.js`, `src/components/providers/service-worker-registration.tsx`; create `src/lib/offline/prepare-shell.ts`; test `tests/unit/offline/prepare-shell.test.ts` and production browser test.

**Interfaces:** `prepareOfflineShell(): Promise<{ cachedRoutes: number; cachedAssets: number; templateCached: boolean }>` posts `PREPARE_OFFLINE` to the controlling worker and rejects on missing resources.

- [ ] Add a failing test: the worker prepares all fixed workspace routes and `/EMV Report Sample.docx`, reports a missing asset, and never caches a credentialed navigation response.
- [ ] Run `npx vitest run tests/unit/offline/prepare-shell.test.ts`; confirm failure.
- [ ] Implement public-shell fetches with `credentials: 'omit'`, discover route CSS/JS assets, cache immutable static assets and the template, and reply with a correlated result. Keep online navigation network-first without caching its response.
- [ ] Run focused tests and a production offline browser probe, including a forced restart.

### Task 2: Account-safe offline startup

**Files:** Create `src/lib/auth/offline-account.ts`; modify `src/app/login/page.tsx`, `src/features/auth/workspace-auth-gate.tsx`, `src/lib/sync/runtime.ts`, and sign-out handling; test `tests/unit/auth/offline-account.test.ts` and `tests/unit/sync/runtime.test.ts`.

**Interfaces:** `saveVerifiedOfflineAccount(account: OnlineAccount, authUserId: string): void`, `readVerifiedOfflineAccount(authUserId: string): AccountScope | undefined`, `clearVerifiedOfflineAccount(): void`. The cached identity is valid only for local reads/writes and must match the retained Supabase user id.

- [ ] Add failing tests for offline cold startup with a matching cached identity, absent identity, mismatched identity, and sign-out/account switch.
- [ ] Run the focused tests and confirm failures.
- [ ] Persist only verified account id, organization id, username, role, active state, and auth user id after online sign-in. Restore repository scope offline before rendering workspace data; on reconnect revalidate online and resume sync. Reject mismatches and clear on sign-out.
- [ ] Run the focused tests and inspect IndexedDB writes for the expected account scope.

### Task 3: Static offline inspection navigation

**Files:** Create `src/app/inspect/work/page.tsx` and its client query adapter; modify inspection links in Lookup, Dashboard, Activity, and offline navigation in the shell/editor; test `tests/unit/inspection/offline-route.test.tsx` and `tests/e2e/offline-fieldwork.spec.ts`.

**Interfaces:** `inspectionHref(id: string, options: { catalogId?: string; view?: boolean; offline: boolean }): string` returns a fixed `/inspect/work` URL when offline and preserves existing online `/inspect/<id>` URLs.

- [ ] Add a failing production browser test that starts a never-seen inspection id after network loss, saves a draft, and reopens it after a page reload.
- [ ] Confirm the current dynamic server route fails the test.
- [ ] Render the existing `InspectionGuard` and `InspectionEditor` on the prepared fixed route using client query parameters. Use document navigation for offline links where server-component requests would fail.
- [ ] Run the browser test with airplane mode and existing online inspection tests.

### Task 4: Readiness UI and sync data checks

**Files:** Create `src/lib/offline/offline-readiness.ts` and `src/features/sync/offline-preparation.tsx`; integrate with `src/features/sync/sync-view.tsx`; test `tests/unit/offline/offline-readiness.test.ts` and `tests/unit/sync/sync-view.test.tsx`.

**Interfaces:** `getOfflineReadiness(repository, shell): Promise<OfflineReadiness>` returns explicit account/catalog/sync/shell/template checks; `prepareForOffline()` performs the existing full sync, then shell preparation, then rechecks local state.

- [ ] Add failing tests for empty catalog, manifest row-count mismatch, missing account scope, incomplete shell, successful preparation, and failed pull.
- [ ] Run focused tests and confirm failures.
- [ ] Add the preparation action and a compact checklist on Sync. Keep the existing separate remote-photo estimate/action; do not silently download every photo.
- [ ] Run focused tests and verify the ready state survives reload.

### Task 5: Offline file exports

**Files:** Modify `src/features/report/docx-template.ts`, `src/lib/transfer/transfer-file.ts` if Android testing shows a delivery issue, and offline cache assets; test `tests/unit/report/docx-template.test.ts`, `tests/unit/transfer/transfer-file.test.ts`, and `tests/e2e/offline-fieldwork.spec.ts`.

**Interfaces:** Existing `downloadEmvReport` and `downloadTransferFile` signatures remain. The DOCX template is served from the prepared local cache when offline; file delivery failures are surfaced.

- [ ] Add failing browser tests for offline Word and Recovery JSON downloads, names, and file signatures; include report photos already saved locally.
- [ ] Confirm the template fetch fails offline before preparation.
- [ ] Cache the template and adapt file delivery only where the Android browser needs it.
- [ ] Run focused unit and browser tests.

### Task 6: Android package and device proof

**Files:** Create `android-twa/` project or reproducible build instructions plus `docs/android-offline.md`; modify `src/app/manifest.ts` only if validation finds missing TWA requirements; test production offline suite.

**Interfaces:** Bubblewrap points to the confirmed HTTPS manifest. The signing certificate fingerprint is published as `/.well-known/assetlinks.json` for the production origin; keystore material stays outside git.

- [ ] Verify production manifest, HTTPS origin, icons, and existing Android/JDK tools. Build an unsigned test APK if the signing key or production origin is unavailable.
- [ ] Install on a connected Android device, prepare online, enable airplane mode, force-stop/reopen, inspect, export Word/JSON, and reconnect/sync.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` from a production build. Document exact APK/build/signing steps and any device-only verification still required.
