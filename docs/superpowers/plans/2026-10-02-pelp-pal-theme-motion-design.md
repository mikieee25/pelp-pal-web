# PELP Pal Web Theme, Motion, and Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the MUI runtime theme with `public/system-theme.md`, add offline-safe Inter typography and GSAP motion utilities, and verify responsive behavior across phones, tablets, and desktop layouts.

**Architecture:** Keep `src/theme/theme.ts` as the single MUI `createTheme` assembly point and `src/theme/tokens.ts` as its semantic token source. Keep GSAP in a client-only animation utility with reduced-motion and cleanup handling; components opt into purposeful transitions without putting animation execution in the theme provider. Use MUI breakpoints plus safe-area-aware global/layout styles for responsive behavior.

**Tech Stack:** Next.js 16 App Router, React 19, MUI 7, Emotion, GSAP 3.15.0, `@fontsource-variable/inter` 5.3.0, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-pelp-pal-theme-motion-design.md`

## Global Constraints

- MUI v7 is the runtime component system.
- Keep `src/theme/theme.ts` as `.ts`, because it contains no JSX.
- Use a self-contained Inter font setup suitable for offline-first behavior.
- Add GSAP as a production dependency.
- Stay client-side; server components must not import browser-only animation code.
- Respect `prefers-reduced-motion` by skipping or minimizing motion.
- Use a mobile-first MUI layout strategy.
- All interactive controls must remain keyboard accessible and provide touch targets of at least 44 CSS pixels where practical.
- Fixed mobile navigation and bottom actions must account for `env(safe-area-inset-bottom)`.
- Avoid `100vh`-only sizing for user-facing content.
- No replacement of MUI with Tailwind, shadcn, or another component system.
- No dependency on a remote font CDN for core rendering.
- Do not commit, push, delete, or modify unrelated existing worktree changes.

## File Map

- Modify `package.json` and `package-lock.json`: add GSAP and local Inter font packages.
- Modify `src/theme/tokens.ts`: define semantic colors, typography, control sizing, radius, motion, and layout values.
- Modify `src/theme/theme.ts`: assemble MUI palette, typography, shape, breakpoints, and shared component defaults/overrides from tokens.
- Modify `src/app/globals.css`: load local Inter CSS, apply the shared font fallback, enforce dynamic viewport and safe-area baselines, and preserve reduced-motion behavior.
- Modify `src/theme/app-theme-provider.tsx`: continue providing the MUI theme without importing GSAP or browser animation code.
- Create `src/lib/animation/gsap.ts`: expose the small reduced-motion-safe GSAP boundary.
- Modify `src/app/(workspace)/dashboard/dashboard-view.tsx`: apply one purposeful page-entry transition using the animation boundary.
- Modify `src/components/app-shell/app-shell.tsx`: make mobile navigation and shell height safe-area-aware and touch-friendly.
- Modify `playwright.config.ts`: add iPhone, Android, and iPad responsive projects without rerunning the full suite for each device.
- Create `tests/unit/theme.test.ts`: lock the centralized typography and semantic theme contract.
- Create `tests/unit/animation/gsap.test.ts`: cover reduced-motion and cleanup behavior.
- Create `tests/e2e/responsive.spec.ts`: check overflow, visible controls, labels, and mobile navigation at representative device sizes.
- Modify `public/system-theme.md`: document the actual MUI, token, Inter, GSAP, and responsive sources.

---

### Task 1: Add GSAP and local Inter dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `gsap@3.15.0` and `@fontsource-variable/inter@5.3.0` available to the application bundle.

- [x] **Step 1: Add the production dependencies**

Run:

~~~powershell
npm install gsap@3.15.0 @fontsource-variable/inter@5.3.0
~~~

Expected: `package.json` and `package-lock.json` contain both packages under `dependencies`; no unrelated package upgrades occur.

- [x] **Step 2: Verify the dependency graph**

Run:

~~~powershell
npm ls gsap @fontsource-variable/inter --depth=0
~~~

Expected: both packages resolve to the requested versions with exit code 0.

### Task 2: Centralize the MUI theme and Inter typography

**Files:**
- Modify: `src/theme/tokens.ts`
- Modify: `src/theme/theme.ts`
- Modify: `src/app/globals.css`
- Modify: `src/theme/app-theme-provider.tsx`
- Create: `tests/unit/theme.test.ts`

**Interfaces:**
- Produces: `designTokens.typography.fontFamily`, `designTokens.motion`, `designTokens.layout`, and semantic palette values consumed by `appTheme`.
- Produces: document and MUI components using the same Inter-first font stack.

- [x] **Step 1: Write the failing theme contract test**

Create `tests/unit/theme.test.ts`:

~~~ts
import { describe, expect, it } from 'vitest';
import { appTheme } from '@/theme/theme';
import { designTokens } from '@/theme/tokens';

describe('appTheme', () => {
  it('uses the centralized Inter typography and semantic palette', () => {
    expect(appTheme.typography.fontFamily).toBe(designTokens.typography.fontFamily);
    expect(appTheme.palette.primary.main).toBe(designTokens.colors.primary);
    expect(appTheme.palette.background.default).toBe(designTokens.colors.canvas);
    expect(appTheme.shape.borderRadius).toBe(designTokens.radius.md);
  });
});
~~~

- [x] **Step 2: Run the focused test to verify it fails**

Run:

~~~powershell
npm test -- tests/unit/theme.test.ts
~~~

Expected: FAIL because `typography` and the Inter font token do not yet exist.

- [x] **Step 3: Expand the token source**

Update `src/theme/tokens.ts` with a typed token object that includes at least:

~~~ts
typography: {
  fontFamily: 'Inter, Arial, Helvetica, sans-serif',
  monoFontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
},
motion: {
  duration: { fast: 0.15, standard: 0.2, slow: 0.35 },
  ease: { standard: 'power2.out', emphasized: 'power3.out' },
  offset: 12,
},
layout: {
  navigationWidth: 240,
  mobileNavigationHeight: 64,
  touchTarget: 44,
},
~~~

Keep the existing color values unless a semantic name is required to express the same existing role. Add a `focus` color if the current palette does not already expose one.

- [x] **Step 4: Assemble the MUI theme from tokens**

Update `src/theme/theme.ts` to consume token values for:

- `typography.fontFamily` and body typography.
- `palette.primary`, `background`, `text`, `divider`, `success`, `warning`, `error`, and focus-related component states.
- `shape.borderRadius`.
- `breakpoints` using MUI defaults unless a component needs a documented custom boundary.
- `MuiButtonBase`/`MuiButton` touch-friendly minimum sizing.
- `MuiBottomNavigationAction` readable label sizing and minimum height.

Do not move GSAP imports into the theme.

- [x] **Step 5: Load Inter locally and apply the shared baseline**

Import the variable font CSS at the top of `src/app/globals.css`:

~~~css
@import '@fontsource-variable/inter';
~~~

Set `font-family: 'Inter', Arial, Helvetica, sans-serif` on `body`, preserve `min-width: 320px`, and replace viewport-only `min-height: 100vh` declarations in the global baseline with `min-height: 100dvh` while retaining a fallback where needed.

- [x] **Step 6: Run the focused test to verify it passes**

Run:

~~~powershell
npm test -- tests/unit/theme.test.ts
~~~

Expected: PASS.

### Task 3: Build the reduced-motion-safe GSAP boundary

**Files:**
- Create: `src/lib/animation/gsap.ts`
- Create: `tests/unit/animation/gsap.test.ts`

**Interfaces:**
- Produces: `type AnimationCleanup = () => void`.
- Produces: `fadeUp(target: Element | null): AnimationCleanup`.
- Produces: `prefersReducedMotion(): boolean`.

- [x] **Step 1: Write the failing utility tests**

Create tests covering the public behavior:

~~~ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeUp, prefersReducedMotion } from '@/lib/animation/gsap';

describe('GSAP animation boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  it('detects reduced motion from the browser preference', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns a safe cleanup function for reduced-motion users', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const cleanup = fadeUp(document.createElement('div'));
    expect(cleanup).toEqual(expect.any(Function));
    expect(() => cleanup()).not.toThrow();
  });
});
~~~

- [x] **Step 2: Run the focused test to verify it fails**

Run:

~~~powershell
npm test -- tests/unit/animation/gsap.test.ts
~~~

Expected: FAIL because the module and functions do not yet exist.

- [x] **Step 3: Implement the minimal GSAP boundary**

Create `src/lib/animation/gsap.ts` as a client-only module. It should:

1. Return `true` from `prefersReducedMotion()` only when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` is true.
2. Return `false` without touching `window` when evaluated outside a browser.
3. Return a no-op cleanup when the target is null or reduced motion is enabled.
4. Create a `gsap.context()` for normal motion.
5. Animate from `autoAlpha: 0` and `y: designTokens.motion.offset` to `autoAlpha: 1` and `y: 0` using the tokenized duration/ease.
6. Return `context.revert()` as cleanup.

Keep the module free of React imports so it can be tested independently.

- [x] **Step 4: Run the focused test to verify it passes**

Run:

~~~powershell
npm test -- tests/unit/animation/gsap.test.ts
~~~

Expected: PASS.

### Task 4: Apply one purposeful animation to the dashboard

**Files:**
- Modify: `src/app/(workspace)/dashboard/dashboard-view.tsx`

**Interfaces:**
- Consumes: `fadeUp(target: Element | null): AnimationCleanup` from `src/lib/animation/gsap.ts`.
- Produces: a cleaned-up page-entry transition for the dashboard content.

- [x] **Step 1: Add the dashboard animation hook**

Add a `useLayoutEffect` and `useRef<HTMLDivElement>(null)` to the existing client component. Put the ref on the dashboard content wrapper and return `fadeUp(ref.current)` from the effect. Do not animate count values or delay the data query.

- [x] **Step 2: Verify normal and reduced-motion rendering**

Run:

~~~powershell
npm test -- tests/unit/animation/gsap.test.ts
npm run test:e2e -- tests/e2e/shell.spec.ts
~~~

Expected: utility tests and existing browser smoke tests pass; dashboard content remains visible when reduced motion is enabled.

### Task 5: Make the shell safe and usable on phones and tablets

**Files:**
- Modify: `src/components/app-shell/app-shell.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/theme/theme.ts`

**Interfaces:**
- Consumes: `designTokens.layout.navigationWidth`, `mobileNavigationHeight`, and `touchTarget`.
- Produces: safe-area-aware mobile navigation, dynamic viewport shell sizing, and touch-friendly MUI controls.

- [x] **Step 1: Update the shell layout**

Use `minHeight: '100dvh'` with a fallback, replace hardcoded drawer width with the theme/token value, and add safe-area-aware bottom padding to the mobile shell:

~~~ts
pb: { xs: 'calc(64px + env(safe-area-inset-bottom))', md: 0 }
~~~

Apply `paddingTop: 'env(safe-area-inset-top)'` to the mobile app bar and `paddingBottom: 'env(safe-area-inset-bottom)'` to the bottom navigation. Preserve the current desktop drawer and four-item mobile navigation behavior.

- [x] **Step 2: Update global overflow and safe-area baselines**

Set `overflow-x: hidden` on the document/body baseline, preserve content scrolling, and use `min-height: 100dvh`. Do not apply global fixed heights to route content.

- [x] **Step 3: Add responsive browser checks before implementation changes are considered complete**

Create `tests/e2e/responsive.spec.ts`:

~~~ts
import { expect, test } from '@playwright/test';

test('keeps the login form usable without horizontal overflow', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();
  await expect(page.getByLabelText(/password/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keeps mobile workspace navigation visible', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
~~~

- [x] **Step 4: Configure representative device projects**

Update `playwright.config.ts` with dedicated responsive projects using Playwright’s built-in `devices` for `iPhone 13`, `Pixel 7`, and `iPad (gen 7)`. Keep the existing desktop project for the general suite and use `testMatch`/`testIgnore` so responsive checks run once per device instead of multiplying every existing test.

- [x] **Step 5: Run responsive checks**

Run:

~~~powershell
npx playwright test tests/e2e/responsive.spec.ts
~~~

Expected: all responsive projects pass with no horizontal overflow and visible form/navigation controls.

### Task 6: Rewrite the system theme documentation

**Files:**
- Modify: `public/system-theme.md`

**Interfaces:**
- Consumes: the final names and locations from Tasks 2–5.
- Produces: documentation that maps semantic design decisions to actual MUI runtime files.

- [x] **Step 1: Replace stale Tailwind/shadcn references**

Document the actual sources:

- `src/theme/tokens.ts` — semantic token source.
- `src/theme/theme.ts` — MUI theme assembly.
- `src/theme/app-theme-provider.tsx` — provider boundary.
- `src/app/globals.css` — local Inter import, document baseline, safe areas, and reduced-motion fallback.
- `src/lib/animation/gsap.ts` — GSAP boundary and cleanup contract.
- `src/components/app-shell/app-shell.tsx` — responsive shell/navigation.

- [x] **Step 2: Document practical MUI recipes**

Include examples for:

- `sx` values using `theme.palette`, `theme.spacing`, `theme.shape`, and breakpoints.
- Inter typography variants.
- 44px touch targets.
- Safe-area-aware fixed navigation.
- GSAP entry animations with cleanup and reduced-motion handling.
- Phone, tablet, landscape, and desktop layout expectations.

Label conceptual CSS snippets as documentation only; do not create a second stylesheet that competes with MUI.

- [x] **Step 3: Check documentation consistency**

Run:

~~~powershell
rg -n "src/styles/theme.css|src/components/ui|Tailwind|shadcn|theme.css" public/system-theme.md
~~~

Expected: no stale implementation references remain.

### Task 7: Run the complete verification gate

**Files:**
- No additional files.

- [x] **Step 1: Run unit tests**

~~~powershell
npm test
~~~

Expected: all Vitest test files pass.

- [x] **Step 2: Run lint and typecheck**

~~~powershell
npm run lint
npm run typecheck
~~~

Expected: both commands exit 0.

- [x] **Step 3: Run desktop and responsive browser tests**

~~~powershell
npm run test:e2e
npx playwright test tests/e2e/responsive.spec.ts
~~~

Expected: desktop smoke tests and all iPhone/Android/iPad responsive checks pass.

- [x] **Step 4: Run the production build**

~~~powershell
npm run build
~~~

Expected: Next.js compiles, type checking completes, and all routes generate successfully.

- [x] **Step 5: Review the final worktree**

~~~powershell
git diff --check
git status --short
~~~

Confirm that only the approved theme, animation, responsive, documentation, dependency, and test files changed. Do not commit or push without explicit authorization.
