# PELP Pal Web System Theme

This document describes the runtime theme used by the PELP Pal web client. MUI is the component system and the files below are the runtime sources of truth.

## Runtime sources

| Source | Responsibility |
| --- | --- |
| `src/theme/tokens.ts` | Semantic colors, typography, motion, radii, layout, and touch-target values. |
| `src/theme/theme.ts` | MUI `createTheme` assembly, palette, typography, shape, and component defaults. |
| `src/theme/app-theme-provider.tsx` | Provides the MUI theme and registers the service worker. |
| `src/app/globals.css` | Local Inter font import, document baseline, dynamic viewport sizing, safe-area baseline, and reduced-motion CSS fallback. |
| `src/components/app-shell/app-shell.tsx` | Responsive desktop drawer, mobile top bar, and bottom navigation. |
| `src/lib/animation/gsap.ts` | Reduced-motion-safe GSAP animation boundary. |

Do not add a competing component system or second global theme stylesheet. If a visual value needs to change, update the token or MUI theme source first.

## Typography

The primary UI font is local Inter from `@fontsource-variable/inter`. The fallback stack is:

~~~text
Inter, Arial, Helvetica, sans-serif
~~~

The same family is applied to MUI typography and the document body. MUI controls inherit the theme family, while global text uses the baseline in `src/app/globals.css`.

Use MUI typography variants instead of one-off font sizes:

~~~tsx
<Typography component="h1" variant="h4">
  Dashboard
</Typography>
<Typography variant="body1" color="text.secondary">
  Supporting description
</Typography>
~~~

The mono family is reserved for code and data values:

~~~ts
designTokens.typography.monoFontFamily
~~~

## Semantic tokens

Current light-theme values live in `src/theme/tokens.ts`:

| Token role | Runtime meaning |
| --- | --- |
| `canvas` | Application background. |
| `surface` | Paper and card background. |
| `ink` | Primary text. |
| `muted` | Secondary text and labels. |
| `primary` | Main action and selected state. |
| `primaryDark` | Strong primary emphasis. |
| `border` | Divider and control border. |
| `focus` | Keyboard focus and informational emphasis. |
| `success` | Successful or healthy state. |
| `warning` | Warning or attention state. |
| `danger` | Error and destructive state. |

Components should use MUI semantic values:

~~~tsx
<Paper sx={{ bgcolor: 'background.paper', borderColor: 'divider' }}>
  <Typography color="text.secondary">Secondary content</Typography>
  <Button color="primary" variant="contained">Save</Button>
</Paper>
~~~

Avoid raw brand values in components:

~~~tsx
// Avoid
<Box sx={{ color: '#0b5cab' }} />

// Use
<Box sx={{ color: 'primary.main' }} />
~~~

To change the application palette, update `designTokens.colors` and the corresponding semantic MUI palette in `src/theme/theme.ts`.

## Shape, spacing, and controls

Use MUI spacing and the shared radius tiers:

~~~tsx
<Paper sx={{ p: 3, borderRadius: 2 }}>
  Content
</Paper>
~~~

- `radius.sm`, `radius.md`, and `radius.lg` define the shared radius tiers.
- `theme.spacing` provides the spacing scale.
- Buttons and bottom-navigation actions have a 44px minimum touch target.
- Forms remain full-width on narrow screens.
- Do not introduce arbitrary control heights without a responsive reason.

## Responsive layout

The UI is mobile-first.

| Viewport | Layout expectation |
| --- | --- |
| Phone | Single-column content, full-width actions, mobile app bar, and bottom navigation. |
| Tablet | Readable content width; two-column layout only when the available width supports it. |
| Desktop | Persistent drawer and wider content containers. |
| Landscape | Content remains scrollable without vertical clipping or fixed-height assumptions. |

Use MUI breakpoints through responsive `sx` values:

~~~tsx
<Container
  maxWidth="lg"
  sx={{
    px: { xs: 2, sm: 3, md: 4 },
    py: { xs: 3, md: 5 },
  }}
>
  Content
</Container>
~~~

Responsive requirements:

- Keep the document at least 320px wide.
- Prevent horizontal overflow without preventing vertical scrolling.
- Use `100dvh` for viewport-sized shells with a `100vh` fallback.
- Account for `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` on fixed mobile navigation.
- Keep controls keyboard accessible and at least 44 CSS pixels where practical.
- Recheck layouts when the virtual keyboard changes the visible viewport.
- Test iPhone, Android phone, iPad/tablet, narrow desktop, and desktop sizes.

The mobile shell uses the first four primary routes in bottom navigation. The desktop shell uses the persistent drawer. These are intentional responsive variants of the same navigation model.

## Motion

GSAP is installed for purposeful UI transitions. Components must import the boundary from `src/lib/animation/gsap.ts` rather than importing GSAP directly.

The boundary provides:

~~~ts
type AnimationCleanup = () => void;
function prefersReducedMotion(): boolean;
function fadeUp(target: Element | null): AnimationCleanup;
~~~

Example:

~~~tsx
'use client';

import { useLayoutEffect, useRef } from 'react';
import { fadeUp } from '@/lib/animation/gsap';

export function AnimatedPanel() {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => fadeUp(panelRef.current), []);

  return <div ref={panelRef}>Panel content</div>;
}
~~~

The animation boundary:

- Uses duration and easing values from `designTokens.motion`.
- Skips non-essential motion when `prefers-reduced-motion: reduce` is active.
- Uses GSAP context cleanup when the component unmounts.
- Does not run in server components.
- Should animate meaningful state transitions, not every hover or data value.

Use motion for page entry, panel transitions, and clear save/sync feedback. Do not animate inspection data in ways that distract field work.

## Accessibility and reduced motion

The global baseline preserves reduced-motion behavior:

~~~css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
~~~

JavaScript-driven animation must also use the GSAP reduced-motion guard. Reduced motion is an accessibility requirement, not an optional visual preference.

## Changing the theme

For a global UI change:

1. Update or add a semantic value in `src/theme/tokens.ts`.
2. Map it into `src/theme/theme.ts`.
3. Use the MUI semantic role in components.
4. Update this document if the role or recipe changes.
5. Run unit, lint, typecheck, build, and responsive browser checks.

For a component-specific layout change, use responsive MUI `sx` values before adding a new token. Add a token only when the value is shared or represents a named design decision.

## Verification

Run:

~~~powershell
npm test
npm run lint
npm run typecheck
npm run test:e2e
npx playwright test tests/e2e/responsive.spec.ts
npm run build
~~~

The responsive suite covers iPhone 13, Pixel 7, and iPad (gen 7) using Chromium emulation. Conceptual CSS examples in this document explain the runtime design; they are not a second stylesheet.
