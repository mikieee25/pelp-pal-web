# PELP Pal Web Theme, Motion, and Responsive Design

## Goal

Align the documented PELP Pal design system with the actual MUI application, add a centralized runtime theme, introduce GSAP for purposeful UI motion, and make the workspace reliable across desktop browsers, tablets, Android phones, and iPhones.

## Current state

- MUI v7 is the runtime component system.
- `src/theme/theme.ts` creates the MUI theme.
- `src/theme/tokens.ts` contains a small set of color, radius, and motion tokens.
- `src/theme/app-theme-provider.tsx` provides the theme and registers the service worker.
- `public/system-theme.md` currently documents a Tailwind/shadcn implementation that is not present in this repository.
- The runtime font is currently Arial, while the design document specifies Inter.
- GSAP is not installed.
- The app already includes a reduced-motion CSS rule and a responsive MUI layout pattern.

## Design

### Central theme

Keep `src/theme/theme.ts` as `.ts`, because it contains no JSX. It remains the single MUI `createTheme` entry point and consumes centralized values from `tokens.ts`.

Expand `tokens.ts` to own:

- Semantic colors for canvas, surface, text, muted text, border, primary, success, warning, danger, and focus.
- Typography family and weights, using Inter with a system fallback stack.
- Radius tiers and shared control sizing.
- Motion durations and easing values.
- Responsive layout constants only where MUI breakpoints do not express the need.

Components should consume MUI semantic palette values, theme spacing, typography variants, breakpoints, and shared component overrides instead of introducing one-off brand values.

### Inter

Use a self-contained Inter font setup suitable for offline-first behavior. Prefer a repository-local font asset or a configured font source that does not make initial rendering depend on a remote network request. Keep the fallback stack available when the font cannot load.

Set the same family in the MUI typography theme and the document/body baseline so MUI controls and non-MUI text do not diverge.

### GSAP boundary

Add GSAP as a production dependency. Keep animation execution outside the theme provider:

```text
src/lib/animation/gsap.ts
```

The shared animation boundary will:

- Expose a small set of purposeful transitions, such as fade-up and state feedback.
- Use centralized duration and easing tokens.
- Respect `prefers-reduced-motion` by skipping or minimizing motion.
- Use GSAP context cleanup so animations do not survive component unmounts.
- Stay client-side; server components must not import browser-only animation code.

Do not animate every component by default. Initial usage should focus on page entry, dashboard content, panel transitions, and meaningful save/sync success or error feedback.

### Responsive behavior

Use a mobile-first MUI layout strategy:

- Phones: single-column content, compact spacing, full-width actions, and fixed bottom navigation where applicable.
- Tablets: two-column layouts only where the available width supports them; preserve readable content width and avoid dense desktop navigation.
- Desktop: persistent navigation and wider content containers.
- Landscape phones/tablets: avoid vertical clipping and allow content to scroll naturally.

All interactive controls must remain keyboard accessible and provide touch targets of at least 44 CSS pixels where practical. Fixed mobile navigation and bottom actions must account for `env(safe-area-inset-bottom)`. Avoid `100vh`-only sizing for user-facing content; use dynamic viewport units or content-driven layouts where viewport chrome can reduce the visible area.

Responsive verification will cover representative iPhone, Android phone, iPad/tablet, narrow desktop, and desktop viewports. Checks will include no horizontal overflow, visible labels and buttons, usable bottom navigation, readable text, and form interaction after the virtual keyboard changes the viewport.

### Documentation

Rewrite `public/system-theme.md` around the actual MUI sources:

- `src/theme/tokens.ts` as token source.
- `src/theme/theme.ts` as MUI theme assembly.
- `src/theme/app-theme-provider.tsx` as provider boundary.
- `src/app/globals.css` as the global baseline and reduced-motion fallback.
- `src/lib/animation/gsap.ts` as the animation boundary.

Document semantic usage and responsive recipes, and label conceptual CSS examples as documentation rather than a second stylesheet.

## Acceptance criteria

- MUI runtime theme uses the centralized tokens and Inter fallback stack.
- `public/system-theme.md` describes files and patterns that exist in this repository.
- GSAP is installed and only used through the shared animation boundary.
- Reduced-motion users do not receive non-essential motion.
- Existing login, workspace, and form behavior remains intact.
- Phone and tablet layouts have no clipped labels, horizontal overflow, or inaccessible fixed navigation.
- Unit, lint, typecheck, build, and responsive browser checks pass.

## Scope exclusions

- No broad visual redesign of every page.
- No replacement of MUI with Tailwind, shadcn, or another component system.
- No animation of data or inspection content that could distract from field work.
- No dependency on a remote font CDN for core rendering.
