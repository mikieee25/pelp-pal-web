# Full HeroUI Migration Design

## Goal

Replace MUI across PELP Pal Web with HeroUI v3, Tailwind CSS v4, and Lucide icons. The `redesign` branch is the migration target; deployed `main` remains unchanged. The finished app must contain no MUI or Emotion packages, imports, providers, test mocks, or styling references.

Preserve the current PELP visual identity, responsive behavior, routes, access rules, copy unless a component API requires a small accessible adjustment, and all product behavior. This is a UI-framework migration, not a sync, storage, database, authentication, or protocol change.

## Chosen approach

Perform one complete migration on `redesign`, editing in logical slices and running focused checks throughout, but without intermediate commits. This gives one coherent result while keeping failures localized. Remove MUI dependencies only after every application and test reference is migrated.

HeroUI v3 compound components provide accessible interaction behavior through React Aria. Use HeroUI for interactive controls and overlays, native semantic HTML for page structure and report tables where that is the clearer fit, and Tailwind utilities for layout. Use `lucide-react` for the icon set, with named imports and accessible names on icon-only actions. No HeroUI provider is needed unless locale-sensitive behavior in the migrated components requires one.

## Theme and shared components

- Retain the existing PELP color, typography, spacing, radius, sizing, and motion decisions in `src/theme/tokens.ts`; expose their semantic CSS variables and Tailwind v4 theme names in the global stylesheet.
- Keep Inter Variable, tabular numerals, the monospace treatment for identifiers, existing safe-area layout, and `prefers-reduced-motion` handling.
- Rebuild `src/components/ui` primitives with HeroUI and semantic HTML/Tailwind while preserving their public purpose and accessibility contract: PageShell, PageHeader, Section, Surface, ListRow, Stat, StatusBadge, EmptyState, InlineNotice, ActionBar, and KeyValueList.
- Remove the MUI theme, `CssBaseline`, `ThemeProvider`, and Next App Router cache provider. Keep the service-worker lifecycle currently hosted in the theme provider by moving it to a framework-neutral client provider/module before deleting that file.
- Preserve the app shell's desktop navigation, mobile menu and bottom navigation, active state, sync status pill, safe-area behavior, and role-based navigation visibility.

## Migration scope

Migrate every user-facing screen and reusable surface:

- Dashboard, Lookup and QR scanner, official DOE record, Activity, Summary, Report and document preview, Inspection view/editor and photo flows.
- Sync and recovery transfer, including confirmations, progress, errors, and photo repair/download controls.
- Personnel, Store, Account, Login, password change, catalog details and catalog management.
- App shell, sync pill, loading and error pages, not-found page, forms, menus, drawers, dialogs, alerts, tables, and empty states.

Retain current navigation structure and PELP layout. Keep inspection/report tables semantically correct, use keyboard-accessible controls, and avoid introducing horizontal overflow at phone/tablet widths.

## Behavior and compatibility constraints

- Preserve event handlers, validation, permissions, navigation, focus transitions, keyboard paths, `aria-label`s, `data-testid`s, and loading/empty/error/retry states.
- Preserve all authentication, IndexedDB, offline, synchronization, evidence, DOE lookup, and report-generation behavior; do not change backend contracts or data formats.
- Preserve GSAP transitions and ensure reduced-motion preferences continue to disable motion.
- Update tests only when HeroUI legitimately changes role/markup semantics. Do not weaken assertions about behavior.
- Preserve the existing uncommitted work in the working tree and do not commit or push without explicit authorization.

## Verification

During migration, run focused component tests after each logical slice. Before declaring completion:

1. `npm run lint`, `npm run typecheck`, and `npm test` pass.
2. `npm run build` passes.
3. The Playwright suite passes; any credential- or environment-gated skips are reported with reasons.
4. Responsive checks at 320, 375, 768, and 1280 CSS pixels show no horizontal overflow or overlapping controls. Verify the major inspection, lookup, activity, and sync interactions at phone and tablet widths.
5. Repository searches and dependency inspection show no `@mui/*`, `@emotion/*`, MUI cache/provider code, or MUI-specific CSS selectors remain.

## Risks and mitigations

- HeroUI v3 uses compound APIs rather than MUI's prop-heavy components. Migrate at the shared primitive boundary first and preserve page behavior with component tests.
- Dialog, drawer, popover, scanner, and mobile filter interactions have focus and scroll-lock requirements. Test keyboard use, escape/outside dismissal, scroll behavior, and touch-sized actions explicitly.
- Removing MUI's Next cache provider and theme provider may affect CSS ordering or service-worker registration. Verify production build, client navigation, font loading, and service-worker registration after moving lifecycle code.
- Existing user changes are present in the worktree. Inspect overlapping diffs before editing and preserve unrelated changes.
