# Remaining Screens Redesign

## Goal

Apply the existing `src/components/ui/` design-system primitives to the remaining application screens without changing routes, handlers, data flow, permissions, or business behavior. Keep MUI as the control library and add a primitive only if the requested layouts cannot be expressed by the existing primitives.

## Shared constraints

- Use `PageShell`, `PageHeader`, `Section`, `Surface`, `ListRow`, `Stat`, `StatusBadge`, `EmptyState`, `InlineNotice`, `ActionBar`, and `KeyValueList` for layout and repeated visual patterns. Avoid ad hoc card-in-card structures.
- Preserve existing handlers, routes, accessibility labels, `data-testid` values, sync/offline behavior, and GSAP motion. Honor `prefers-reduced-motion`.
- Retain MUI inputs, segmented controls, menus, accordions, and dialogs where they already provide the needed interaction. All controls remain keyboard-operable with visible focus and at least 44px touch targets.
- Keep small-screen layouts free of horizontal overflow at 320, 375, 768, and 1280 CSS pixels. Preserve semantic heading order and ensure color is not the only status signal.
- Update tests only for intentional visual/text/semantic changes; preserve behavior assertions.

## Screen designs

### Dashboard

Replace the hero and redundant status panels with a task-first page: a primary action block for “Scan label” and “Search catalog”; conditional “Needs attention” rows for failed/conflict work and photos waiting; one compact three-stat row (completed, drafts, waiting to upload); and up to five recent inspections as `ListRow`s. Show exactly one active-store row (“Store: <name> · Change” or “Select a store”). Remove duplicate local-first and sync-readiness copy.

### Lookup

Use one prominent search field with QR scan as an end-adornment icon button. Render product types in a horizontally scrollable chip row. Show catalog hits as `ListRow`s with mono semibold control number, muted brand/model, and trailing product type. Restyle DOE official records with `Section` and `KeyValueList`, retaining current photo, refresh, cache, offline, and error behavior. Replace the store alert with one slim store row.

### Activity

Keep the filter sheet and All/Compliant/Non-compliant segmented control. Make the segmentation sticky below the page header. Render stores as sticky section headers with counts and inspections as `ListRow`s. Tapping a row opens View; Edit and Delete remain available from an overflow menu. Preserve swipe-to-delete, persisted filters/expansion, pagination, and sync actions. Show compliance with `StatusBadge` and sync state with a compact icon and accessible text.

### Summary

Keep real accessible tables on `md` and wider and the current phone card layout. Use metric rows with tabular numerals, a sticky store filter bar, and avoid nested cards.

### Report

Group the existing report form into `Section`s, retain 16px mobile-safe inputs and the “Preview report data” accordion, and place the existing download action in `ActionBar` (sticky on phones). Preserve report generation and photo-appendix behavior.

### Inspection

Use sectioned form content and a sticky `ActionBar` for Save draft and Complete. Present evidence in a two-column photo grid with a clear add-photo tile. Render compliance answers as a segmented control. Preserve validation, draft persistence, evidence lifecycle, read-only behavior, and navigation.

### Personnel

Render the directory as `ListRow`s with `StatusBadge`; place the create-person form in a `Section`; move archive actions into an overflow menu. Preserve authorization, validation, dialogs, and mutation handlers.

### Store form and Login

Apply the shared page spacing, section/form grouping, typography, and action patterns. Preserve existing form fields, validation, auth/session behavior, labels, and navigation.

## Commit and verification plan

1. Validate and commit the already-pending design-system foundation as a separate first commit; it must pass lint, typecheck, all Vitest tests, and `next build`.
2. Commit Dashboard, Lookup, Activity, Summary, Report, Inspection, Personnel, Store, and Login separately, in that order. Each screen commit must pass typecheck, its focused unit tests, and responsive checks for affected routes at 320, 375, 768, and 1280px.
3. After the Inspection commit and after the Login commit, run the full lint, typecheck, test, and build suite. Also run all four checks before the foundation commit.
4. Push only with `git push origin HEAD:redesign`, after the foundation commit, Dashboard commit, and final commit. Never push to `main`.

## Acceptance

All requested layouts use shared primitives, existing behavior remains intact, responsive checks show no horizontal document overflow, accessibility basics are maintained, all planned commits are isolated as above, and final lint/typecheck/tests/build pass. Report per-screen changes and any skipped work or intentional test text/structure changes.
