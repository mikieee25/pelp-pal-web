# Remaining Screens Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the remaining PELP Pal Web screens using the shared UI primitives while preserving all application behavior.

**Architecture:** Keep each screen's existing data and interaction logic in place; replace presentation markup with `src/components/ui/` primitives and existing MUI controls. Keep tests and responsive assertions adjacent to each screen's commit. Add no new primitive unless a concrete repeated need cannot be met by the existing set.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MUI 7, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-remaining-screens-redesign-design.md`

## Global Constraints

- Preserve existing handlers, routes, permissions, labels/ARIA names and `data-testid` values except intentional visible structure/text changes with corresponding tests.
- Keep the MUI theme/tokens, GSAP motion, and `prefers-reduced-motion` support; do not change behavior or sync logic.
- Use only the existing `src/components/ui/` primitives for layout/repeated presentation; MUI remains the control library.
- Keep 44px minimum touch targets, visible focus, non-color status cues, ordered headings, at least 4.5:1 text contrast, and no horizontal overflow at 320, 375, 768, and 1280px.
- Do not push to `main`; push only with `git push origin HEAD:redesign` after foundation, Dashboard, and final commits.
- Foundation is already committed as `84392db` and passed lint, typecheck, all Vitest tests, and `next build`.

---

### Task 1: Dashboard

**Files:**
- Modify: `src/app/(workspace)/dashboard/dashboard-view.tsx`
- Test: `tests/unit/dashboard.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Reuse existing dashboard repository methods (`getDashboardCounts`, `listInspectionDrafts`, `listActivity`, `getSyncStatusCounts`), active-store switch dialog/handlers, route links, and UI primitives. Do not add repository methods or alter count semantics.

- [ ] Update dashboard tests for “Scan label”, “Search catalog”, conditional attention rows, the three stats, recent-inspection ListRows, and exactly one store row.
- [ ] Run `npm test -- tests/unit/dashboard.test.tsx`; confirm new layout assertions fail while existing behavior assertions remain meaningful.
- [ ] Replace hero/readiness/store alert presentation with the approved task-first sections. Use filtered `listActivity` reads for failed/conflict rows, `getSyncStatusCounts` for photo waiting, and `listInspectionDrafts(5)` plus the existing activity read for recency. Preserve routes and switch-store confirmation.
- [ ] Add a responsive Playwright test for `/dashboard` at 320, 375, 768, and 1280px; assert action visibility, touch targets, and `document.documentElement.scrollWidth <= window.innerWidth`.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/dashboard.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "dashboard"`.
- [ ] Review `git diff --check` and commit only the dashboard view and its tests as `feat(dashboard): use task-first shared UI layout`.
- [ ] Push checkpoint: `git push origin HEAD:redesign`.

### Task 2: Lookup

**Files:**
- Modify: `src/app/(workspace)/lookup/lookup-view.tsx`
- Modify: `src/features/lookup/official-product-card.tsx`
- Test: `tests/unit/lookup.test.tsx`
- Test: `tests/unit/doe-record.test.ts` (only if the shared card behavior requires markup assertions)
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve `LookupView`'s catalog search, QR scan, official-record resolution/cache, local matching, and inspection link behavior. Keep `OfficialProductCard` data/API unchanged.

- [ ] Update unit assertions for the QR icon button inside search, horizontally scrollable product-type chips, `ListRow` catalog result content, and the slim store row; retain DOE success/loading/error/offline/partial/cache assertions.
- [ ] Run `npm test -- tests/unit/lookup.test.tsx`; confirm the new presentation assertions fail.
- [ ] Apply `PageShell`/`PageHeader`/`Section`/`ListRow`/`KeyValueList` as appropriate. Move QR to an accessible end-adornment icon button and keep the search field named.
- [ ] Replace the product-type select with a scrollable, keyboard-operable chip group and keep the existing filter value passed to `searchCatalog`.
- [ ] Add `/lookup` responsive checks at 320, 375, 768, and 1280px; verify the full search field and scan button fit and the document does not overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/lookup.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "lookup"`.
- [ ] Review and commit only lookup implementation/tests as `feat(lookup): apply shared primitives`.

### Task 3: Activity

**Files:**
- Modify: `src/features/activity/activity-view.tsx`
- Test: `tests/unit/activity.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve filters and their persistence, expansion state, pagination, sync status/retry actions, view/edit routes, deletion confirmation, and swipe-to-delete behavior.

- [ ] Update tests to assert sticky All/Compliant/Non-compliant control, store section counts, inspection `ListRow`s, view-on-row activation, and Edit/Delete in the row overflow menu.
- [ ] Run `npm test -- tests/unit/activity.test.tsx`; verify the new layout/interaction assertions fail.
- [ ] Replace store and product inspection cards with sticky section labels and `ListRow`s; use `StatusBadge` for outcomes and an accessible compact sync indicator. Preserve swipe-to-delete and filter sheet.
- [ ] Add `/activity` responsive checks at 320, 375, 768, and 1280px for sticky filter behavior, row controls, and no horizontal document overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/activity.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "activity"`.
- [ ] Review and commit only Activity implementation/tests as `feat(activity): use grouped list rows`.

### Task 4: Summary

**Files:**
- Modify: `src/features/summary/summary-view.tsx`
- Test: `tests/unit/summary.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Keep report computation, CSV export, store filter, desktop table semantics, and the existing phone card data and metrics unchanged.

- [ ] Update tests to verify tabular metric rows, sticky filter bar, real tables at desktop widths, current mobile-card metrics at phone widths, and no card-in-card wrappers.
- [ ] Run `npm test -- tests/unit/summary.test.tsx`; confirm only intended structural assertions fail.
- [ ] Compose the filter/table/mobile views with shared primitives and metric rows; preserve native table semantics at `md+` and existing phone card layout.
- [ ] Add `/summary` responsive checks at 320, 375, 768, and 1280px; assert desktop table/phone card breakpoint behavior and no page overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/summary.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "summary"`.
- [ ] Review and commit only Summary implementation/tests as `feat(summary): align metrics with shared UI`.

### Task 5: Report

**Files:**
- Modify: `src/features/report/report-view.tsx`
- Test: `tests/unit/report/report-view.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve report form state, draft persistence, photo-inclusion progress/cancel flow, preview accordion state, and DOCX generation behavior.

- [ ] Update tests for Section-grouped fields, 16px inputs, sticky phone ActionBar, and collapsed “Preview report data”; retain export and photo-appendix behavior tests.
- [ ] Run `npm test -- tests/unit/report/report-view.test.tsx`; confirm new layout assertions fail.
- [ ] Replace ad hoc card wrappers with `Section`/`Surface` and move the existing download action into `ActionBar`; keep preview tables and accordion behavior intact.
- [ ] Add `/report` responsive checks at 320, 375, 768, and 1280px; assert the download action is usable and no horizontal overflow occurs.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/report/report-view.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "report"`.
- [ ] Review and commit only Report implementation/tests as `feat(report): group form and anchor download action`.

### Task 6: Inspection view/editor

**Files:**
- Modify: `src/features/inspection/inspection-editor.tsx`
- Test: `tests/unit/inspection/editor.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve draft lifecycle, validation, step navigation, read-only mode, evidence fetch/cache/retry/add/replace/remove flow, duplicate confirmation, complete/save handlers, and all routes.

- [ ] Update tests for sectioned content, sticky Save draft/Complete actions, two-column photos with an add tile, and segmented compliance answers; keep all lifecycle/evidence assertions.
- [ ] Run `npm test -- tests/unit/inspection/editor.test.tsx`; confirm new presentation assertions fail without weakening existing checks.
- [ ] Apply the shared primitives around the existing form controls; keep the current behavior and data flow unchanged.
- [ ] Add responsive checks for `/inspect/new?catalogId=<fixture>` and the view/edit route at 320, 375, 768, and 1280px, including footer visibility and no page overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/inspection/editor.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "inspection"`.
- [ ] Run the full gate: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Review and commit only Inspection implementation/tests as `feat(inspection): section editor with sticky actions`.

### Task 7: Personnel

**Files:**
- Modify: `src/features/personnel/personnel-view.tsx`
- Test: `tests/unit/personnel-view.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve admin authorization, directory tabs, personnel client calls, create/reset/archive/restore/delete handlers, confirmation dialogs, and success/error feedback.

- [ ] Update tests for active/archived `ListRow`s with `StatusBadge`, Section-wrapped add form, and archive action in overflow menu; retain permission and mutation assertions.
- [ ] Run `npm test -- tests/unit/personnel-view.test.tsx`; confirm new structure assertions fail.
- [ ] Replace directory cards with shared rows and form grouping with `Section`; keep all handlers and disabled rules attached to equivalent controls.
- [ ] Add `/personnel` responsive checks at 320, 375, 768, and 1280px for row actions and no horizontal overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/personnel-view.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "personnel"`.
- [ ] Review and commit only Personnel implementation/tests as `feat(personnel): render directory with shared rows`.

### Task 8: Store form

**Files:**
- Modify: `src/features/store/store-form.tsx`
- Modify: `src/app/(workspace)/store/page.tsx`
- Test: `tests/unit/store.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve saved-store matching, validation, save/cancel, return-path guarding, and the inspection guard.

- [ ] Update tests for shared page/section layout and mobile-safe form controls; retain store-match and routing assertions.
- [ ] Run `npm test -- tests/unit/store.test.tsx`; confirm the new structure assertions fail.
- [ ] Replace the outer ad hoc Paper/container layout with `PageShell`, `PageHeader`, `Section`, and `ActionBar` while retaining every input and callback.
- [ ] Add `/store` responsive checks at 320, 375, 768, and 1280px for labels/actions and no horizontal overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/store.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "store form"`.
- [ ] Review and commit only Store implementation/tests as `feat(store): use shared form layout`.

### Task 9: Login

**Files:**
- Modify: `src/app/login/page.tsx`
- Test: `tests/unit/login.test.tsx`
- Test: `tests/e2e/responsive.spec.ts`

**Interfaces:** Preserve username/password fields, PasswordField, sign-in state/error behavior, session persistence, safe `next` handling, and credential-change redirect.

- [ ] Update tests for shared page spacing and form section structure; retain success, error, and redirect cases.
- [ ] Run `npm test -- tests/unit/login.test.tsx`; confirm only the new structure checks fail.
- [ ] Use `PageShell`, `PageHeader`, `Section`, and `ActionBar` for presentation; retain `AnimatedRoute` and the existing reduced-motion behavior.
- [ ] Add `/login` responsive checks at 320, 375, 768, and 1280px for input/button touch targets and no horizontal overflow.
- [ ] Run `npm run typecheck`, `npm test -- tests/unit/login.test.tsx`, and `npx playwright test tests/e2e/responsive.spec.ts --grep "login"`.
- [ ] Run the final full gate: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- [ ] Review and commit only Login implementation/tests as `feat(login): apply shared form primitives`.
- [ ] Push final checkpoint: `git push origin HEAD:redesign`.

## Responsive test convention

For every affected route, use `page.setViewportSize({ width, height: 900 })` for widths `[320, 375, 768, 1280]`, seed the existing authenticated session for workspace routes, stub only the network calls needed to keep the existing screen fixture deterministic, and assert `document.documentElement.scrollWidth <= window.innerWidth`. Also assert the screen's primary action/control is visible and at least 44px tall. Do not use test-only CSS that could conceal overflow.

## Final review

- Run `git diff --check` and inspect `git status --short --branch` before each commit; stage only the current screen and its unit/E2E tests.
- Confirm the commit history has the foundation followed by exactly one commit per requested screen in order.
- Confirm the only pushed ref is `origin/redesign`; do not push to `main`.
- Summarize each screen's visible changes and list intentional text/structure test updates or any skipped checks.
