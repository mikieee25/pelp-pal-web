# Full HeroUI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Keep the migration on `redesign`; do not push to `main`.

**Goal:** Remove MUI and Emotion completely from PELP Pal Web and migrate the full UI to HeroUI v3, Tailwind CSS v4, and Lucide while preserving behavior and PELP's visual identity.

**Architecture:** Keep one coherent migration on `redesign`, working in testable UI slices without intermediate commits. Move shared primitives and app-shell infrastructure first, migrate every screen and overlay, then remove MUI/Emotion dependencies after a repository-wide reference sweep. Keep business logic, sync protocol, storage, auth, and report formats unchanged.

**Tech Stack:** Next.js App Router 16.3.8, React 19.3.0, HeroUI v3, Tailwind CSS v4, `lucide-react`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-heroui-full-migration-design.md`

## Global Constraints

- The `redesign` branch is the migration target; deployed `main` remains unchanged.
- The finished app must contain no MUI or Emotion packages, imports, providers, test mocks, or styling references.
- Preserve the current PELP visual identity, responsive behavior, routes, access rules, copy unless a component API requires a small accessible adjustment, and all product behavior.
- This is a UI-framework migration, not a sync, storage, database, authentication, or protocol change.
- Retain the existing PELP color, typography, spacing, radius, sizing, and motion decisions in `src/theme/tokens.ts`; expose their semantic CSS variables and Tailwind v4 theme names in the global stylesheet.
- Keep Inter Variable, tabular numerals, the monospace treatment for identifiers, existing safe-area layout, and `prefers-reduced-motion` handling.
- Preserve event handlers, validation, permissions, navigation, focus transitions, keyboard paths, `aria-label`s, `data-testid`s, and loading/empty/error/retry states.
- Preserve all authentication, IndexedDB, offline, synchronization, evidence, DOE lookup, and report-generation behavior; do not change backend contracts or data formats.
- Preserve GSAP transitions and ensure reduced-motion preferences continue to disable motion.
- Update tests only when HeroUI legitimately changes role/markup semantics. Do not weaken assertions about behavior.
- Preserve the existing uncommitted work in the working tree and do not commit or push without explicit authorization.
- Responsive checks must cover 320, 375, 768, and 1280 CSS pixels.

## Baseline and File Map

Before changing code, record `git status --short --branch`, inspect all existing diffs (especially `src/app/login/page.tsx`, `src/features/account/account-view.tsx`, `src/features/catalog/catalog-details.tsx`, `src/features/inspection/inspection-editor.tsx`, `src/features/inspection/validator.ts`, and their tests), and do not discard or overwrite them. The current branch is `redesign`. The full MUI surface is listed by:

```powershell
rg -l '@mui/|@emotion/' src tests
```

Files grouped by responsibility:

- Foundation: `package.json`, `package-lock.json`, `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx`, `src/theme/tokens.ts`, `src/theme/theme.ts`, `src/theme/app-theme-provider.tsx`.
- Shared UI: `src/components/ui/primitives.tsx`, `src/components/ui/index.ts`, `src/components/layout/page-layout.tsx`, `src/components/forms/password-field.tsx`, `src/components/report/mobile-report-card.tsx`.
- Shell and route fallbacks: `src/components/app-shell/app-shell.tsx`, `src/components/app-shell/sync-status-pill.tsx`, `src/app/page.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx`, `src/app/error.tsx`, `src/app/(workspace)/loading.tsx`, `src/app/inspect/[inspectionId]/page.tsx`.
- Screens/features: `src/app/login/page.tsx`, `src/app/(workspace)/dashboard/dashboard-view.tsx`, `src/app/(workspace)/lookup/lookup-view.tsx`, `src/features/activity/activity-view.tsx`, `src/features/summary/summary-view.tsx`, `src/features/report/report-view.tsx`, `src/features/inspection/inspection-editor.tsx`, `src/features/sync/sync-view.tsx`, `src/features/sync/transfer-recovery-panel.tsx`, `src/features/account/account-view.tsx`, `src/features/account/catalog-management-panel.tsx`, `src/features/personnel/personnel-view.tsx`, `src/features/store/store-form.tsx`, `src/features/store/current-store-panel.tsx`, `src/features/store/inspection-guard.tsx`, `src/features/auth/password-change-view.tsx`, `src/features/auth/workspace-auth-gate.tsx`, `src/features/lookup/official-product-card.tsx`, `src/features/lookup/qr-scanner-dialog.tsx`, `src/features/catalog/catalog-details.tsx`.
- Tests: retain the existing focused unit tests under `tests/unit/`; update `tests/e2e/responsive.spec.ts`, `tests/e2e/shell.spec.ts`, and any other browser tests only where the component semantics legitimately change.

## HeroUI API Rules

Use the installed HeroUI v3 API, not v2 examples. Components such as `Select`, `Dialog`, `Tabs`, and form fields use compound parts and React Aria state. Use HeroUI's documented `onPress` for HeroUI buttons while keeping all existing handler effects and async completion semantics. Use semantic HTML for simple layout and data tables rather than adding component wrappers without need. Import named Lucide icons; decorative icons use `aria-hidden="true"`, and icon-only actions retain accessible names.

Next.js CSS setup must follow the local Next guide `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`: PostCSS uses `@tailwindcss/postcss`, global CSS imports Tailwind before HeroUI styles, and the stylesheet remains imported by the root layout.

---

### Task 1: Establish PELP tokens and HeroUI/Lucide styling foundation

**Files:**
- Modify: `src/app/globals.css`, `src/theme/tokens.ts`, `package.json`, `package-lock.json`
- Keep: `postcss.config.mjs` with Tailwind v4 PostCSS plugin
- Test: `tests/unit/theme.test.ts`

**Interfaces:**
- Produces semantic CSS variables/Tailwind theme names matching the current PELP token values; existing motion and layout token consumers continue working.
- Adds `lucide-react`; keeps HeroUI and Tailwind versions currently installed unless a compatibility issue is demonstrated.

- [ ] Add or update token tests for color values, font family, mono/tabular treatment, and reduced-motion CSS.
- [ ] Run `npx vitest run tests/unit/theme.test.ts`; confirm the new CSS-variable/Tailwind-token assertions fail before implementation.
- [ ] Define CSS custom properties and Tailwind v4 theme names from the PELP palette; maintain Tailwind-before-HeroUI import order and Inter Variable.
- [ ] Install Lucide with an exact version and lockfile update; do not add another icon package.
- [ ] Run `npx vitest run tests/unit/theme.test.ts` and `npm run build` to confirm generated styles compile.

### Task 2: Remove MUI root providers and preserve service-worker lifecycle

**Files:**
- Modify: `src/app/layout.tsx`, `src/theme/app-theme-provider.tsx`
- Create: `src/components/providers/service-worker-registration.tsx`
- Test: `tests/unit/service-worker-registration.test.tsx`

**Interfaces:**
- Root layout continues to provide metadata, viewport, global CSS, and children without a MUI cache provider.
- Service-worker behavior remains the same in development and production, independent of any UI library.

- [ ] Add tests with mocked `navigator.serviceWorker` and Cache Storage for production registration and development unregister/cache cleanup before extracting the effect.
- [ ] Run the focused test and confirm it fails for the removed/relocated behavior.
- [ ] Move only the service-worker effect to a framework-neutral client component; remove `ThemeProvider`, `CssBaseline`, and `AppRouterCacheProvider` from the root tree.
- [ ] Run `npx vitest run tests/unit/shell.test.tsx tests/unit/workspace-loading.test.tsx` and `npm run build`.

### Task 3: Rebuild shared UI primitives

**Files:**
- Modify: `src/components/ui/primitives.tsx`, `src/components/ui/index.ts`, `src/components/layout/page-layout.tsx`, `src/components/report/mobile-report-card.tsx`
- Test: `tests/unit/components/ui-primitives.test.tsx`, `tests/unit/page-layout.test.tsx`

**Interfaces:**
- Preserve exported primitive names and intent: `PageShell`, `PageHeader`, `Section`, `Surface`, `ListRow`, `Stat`, `StatusBadge`, `EmptyState`, `InlineNotice`, `ActionBar`, and `KeyValueList`.
- Keep status variants and accessible status text stable; consumers should not need business-logic changes.

- [ ] Add/adjust tests first for semantic headings, list-row button behavior, status names, keyboard activation, and phone sticky/safe-area action bar.
- [ ] Run the two focused tests and confirm the new assertions fail against missing behavior.
- [ ] Replace MUI primitives with HeroUI and semantic HTML/Tailwind, retaining existing props where that prevents churn; use Lucide icons for status and chevrons.
- [ ] Run the two focused tests, `npm run typecheck`, and `npm run lint`.

### Task 4: Migrate application shell, route fallbacks, authentication, and store forms

**Files:**
- Modify: `src/components/app-shell/app-shell.tsx`, `src/components/app-shell/sync-status-pill.tsx`, `src/app/page.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx`, `src/app/error.tsx`, `src/app/(workspace)/loading.tsx`, `src/app/inspect/[inspectionId]/page.tsx`, `src/app/login/page.tsx`, `src/components/forms/password-field.tsx`, `src/features/auth/password-change-view.tsx`, `src/features/auth/workspace-auth-gate.tsx`, `src/features/store/store-form.tsx`, `src/features/store/current-store-panel.tsx`, `src/features/store/inspection-guard.tsx`
- Tests: `tests/unit/app-shell.test.tsx`, `tests/unit/shell.test.tsx`, `tests/unit/login.test.tsx`, `tests/unit/password-field.test.tsx`, `tests/unit/auth/workspace-auth-gate.test.tsx`, `tests/unit/store.test.tsx`, `tests/unit/workspace-loading.test.tsx`, `tests/e2e/shell.spec.ts`, `tests/e2e/auth-guard.spec.ts`

**Interfaces:**
- Keep route URLs, auth submission handlers, current store behavior, admin-only nav visibility, sync pill status text, mobile menu and bottom navigation.
- Root remains a server layout except for the isolated service-worker client component.

- [ ] Add/adjust tests for nav route selection, menu open/close, account role visibility, login validation/submission, password show/hide, store selection/edit/delete, and fallback states.
- [ ] Run focused tests and verify the changed semantic expectations fail before replacing UI markup.
- [ ] Convert shell, auth, and store controls to HeroUI compound components/semantic HTML; maintain touch targets, focus return, escape handling, and safe-area insets.
- [ ] Run the listed unit tests, `npx playwright test tests/e2e/shell.spec.ts tests/e2e/auth-guard.spec.ts`, and typecheck.

### Task 5: Migrate Lookup, scanner, official DOE result, and catalog details

**Files:**
- Modify: `src/app/(workspace)/lookup/lookup-view.tsx`, `src/features/lookup/official-product-card.tsx`, `src/features/lookup/qr-scanner-dialog.tsx`, `src/features/catalog/catalog-details.tsx`
- Tests: `tests/unit/lookup.test.tsx`, `tests/unit/lookup-qr.test.ts`, `tests/unit/qr-scanner-dialog.test.tsx`, `tests/unit/catalog-details.test.tsx`

**Interfaces:**
- Preserve QR parsing and camera lifecycle; online/offline DOE cache behavior; catalog filters; inspection prefill and navigation; official record details and image behavior.
- Keep catalog details concise and preserve existing required product fields; do not reintroduce the full catalog dump.

- [ ] Add/adjust regression tests for scan-to-search, camera permission/error/retry, product-type filter, DOE loading/cache/errors, and concise details expansion.
- [ ] Run the focused tests to verify new role/interaction expectations fail before migration.
- [ ] Replace controls, chips, dialogs, and detail disclosure with HeroUI; preserve image `loading="lazy"`, `referrerPolicy`, and scanner cleanup.
- [ ] Run the focused tests, `npm run typecheck`, and `npm run lint`.

### Task 6: Migrate Activity and Dashboard

**Files:**
- Modify: `src/features/activity/activity-view.tsx`, `src/app/(workspace)/dashboard/dashboard-view.tsx`
- Tests: `tests/unit/activity.test.tsx`, `tests/unit/dashboard.test.tsx`, `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Preserve filter faceting/persistence, collapsed store persistence, store/product expansion, swipe-to-delete, overflow actions, activity revision updates, and repository subscriptions.
- Preserve Dashboard navigation, stats, recent items, and repository-revision updates.

- [ ] Add/adjust Activity tests for filters drawer, selected filter options, group expansion persistence, swipe/delete/undo, and overflow menu; add a Dashboard test for updates after repository revisions.
- [ ] Run both focused tests and confirm the new regression assertions fail.
- [ ] Convert segmented controls, drawers, dialogs, menus, list rows, and responsive stat layout while keeping all data/repository logic unchanged.
- [ ] Run focused tests and responsive Playwright checks at 320, 375, 768, and 1280 pixels.

### Task 7: Migrate Inspection view/editor and photo handling

**Files:**
- Modify: `src/features/inspection/inspection-editor.tsx`, `src/app/inspect/[inspectionId]/page.tsx`
- Tests: `tests/unit/inspection/editor.test.tsx`, `tests/unit/inspection/validator-parity.test.ts`, `tests/unit/inspection-outcome.test.ts`, `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Preserve draft/save/complete/cancel semantics, immutable inspection store identity, normalized mobile/web answer shapes, duplicate-photo rejection, photo-count limit, lazy remote downloads, missing-photo retry, and object URL cleanup.
- Keep all current validator and repository contracts unchanged.

- [ ] Add/adjust tests first for answer formats, validation, photo attach/remove/limit, remote-photo loading/unavailable/retry, and view/edit actions.
- [ ] Run the focused inspection tests and verify any new assertions fail.
- [ ] Convert form fields, answer segmented controls, photo grid, camera/file input affordance, overlays, and sticky action bar to HeroUI/semantic HTML.
- [ ] Run inspection tests, responsive checks at 320/375/768/1280, `npm run typecheck`, and `npm run lint`.

### Task 8: Migrate Summary and Report/document generation UI

**Files:**
- Modify: `src/features/summary/summary-view.tsx`, `src/features/report/report-view.tsx`, `src/components/report/mobile-report-card.tsx`
- Tests: `tests/unit/summary.test.tsx`, `tests/unit/report/report-view.test.tsx`, `tests/unit/report/docx-template.test.ts`, `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Preserve filters, summary calculations, CSV/Word output, non-compliance grouping, optional photo appendix behavior, and the preview accordion default state.
- Retain actual table semantics on wide screens and card semantics on phones.

- [ ] Add/adjust tests for filter application, metric parity, preview disclosure, form errors, download action, and optional evidence appendix toggling.
- [ ] Run focused tests and confirm new assertions fail before conversion.
- [ ] Replace MUI inputs, buttons, accordion, and card wrappers; retain accessible table structure and responsive card layouts.
- [ ] Run focused tests, responsive checks, and `npm run typecheck`.

### Task 9: Migrate Sync, recovery transfer, Account, Personnel, and catalog management

**Files:**
- Modify: `src/features/sync/sync-view.tsx`, `src/features/sync/transfer-recovery-panel.tsx`, `src/features/account/account-view.tsx`, `src/features/account/catalog-management-panel.tsx`, `src/features/personnel/personnel-view.tsx`
- Tests: `tests/unit/sync/sync-view.test.tsx`, `tests/unit/sync/sync-status-pill.test.tsx`, `tests/unit/transfer/transfer-recovery-panel.test.tsx`, `tests/unit/account.test.tsx`, `tests/unit/personnel-view.test.tsx`, `tests/e2e/transfer-recovery.spec.ts`, `tests/e2e/personnel.spec.ts`

**Interfaces:**
- Preserve sync operation selection, status and photo counts, retries, confirmations, progress/cancel flows, JSON import/export/share, account copy/sign-out/password actions, personnel role/archive actions, and catalog publication validation.
- No sync or transfer protocol changes; preserve all file formats and permission checks.

- [ ] Add/adjust tests for every sync headline/error state, force actions, photo repair/download status, recovery JSON export/import/share, account copy/sign-out, personnel create/archive, and catalog publish.
- [ ] Run focused unit tests and verify new semantic assertions fail before migration.
- [ ] Convert all MUI controls and overlays, keeping async handlers, confirmation text, progress, disabled state, and mobile stacking unchanged.
- [ ] Run focused tests and relevant Playwright suites.

### Task 10: Remove remaining MUI/Emotion artifacts and verify full application

**Files:**
- Modify/remove: `src/theme/theme.ts`, `src/theme/app-theme-provider.tsx`, remaining MUI-only test setup/mocks, `package.json`, `package-lock.json`
- Tests: all `tests/unit` and `tests/e2e`

**Interfaces:**
- No `@mui/*` or `@emotion/*` runtime dependencies, imports, providers, selectors, or MUI class assertions remain.
- All routes render with the same navigation and data workflows using HeroUI/Tailwind/Lucide only.

- [ ] Search source, tests, config, and package manifests for `@mui/`, `@emotion/`, `Mui[A-Z]`, `Mui[A-Za-z]+-`, `AppRouterCacheProvider`, and `CssBaseline`; add a failing dependency/reference check if one is absent.
- [ ] Remove MUI/Emotion packages and MUI-only theme/provider files only after the search shows no runtime uses; regenerate the npm lockfile.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npx playwright test --reporter=list`.
- [ ] Run all responsive browser tests at 320, 375, 768, and 1280 pixels; inspect console errors, focus behavior, and horizontal overflow on Login, Lookup, Activity, Inspection, Report, and Sync.
- [ ] Record any environment-gated browser tests skipped and why; do not claim full verification if the browser suite cannot run.

## Final Review Checklist

- [ ] Every MUI reference and package is removed, including any test-only imports or generated CSS class assertions.
- [ ] Existing unrelated dirty changes are preserved.
- [ ] Auth, permissions, routes, IndexedDB, sync, DOE lookup, report output, and service-worker behavior remain unchanged.
- [ ] Keyboard, focus, accessible names, touch targets, mobile safe areas, and reduced-motion behavior are verified.
- [ ] All required commands pass or are reported precisely with the blocker and skipped scope.
- [ ] Do not commit or push unless the user explicitly authorizes it.
