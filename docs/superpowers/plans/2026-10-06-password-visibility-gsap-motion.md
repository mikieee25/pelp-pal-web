# Password Visibility and GSAP Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible password visibility controls and apply a consistent, reduced-motion-safe GSAP presentation layer to the public pages and workspace route boundaries.

**Architecture:** Password inputs will use one MUI-based `PasswordField` component so login, forced password change, and personnel password workflows share the same behavior. Motion will remain behind `src/lib/animation/gsap.ts`; a client-only `AnimatedRoute` wrapper will animate route content on pathname changes after the first paint, while targeted panels use the boundary helpers for state feedback and panel entry. No server component will import GSAP directly.

**Tech Stack:** Next.js App Router 16, React 19, MUI 7, GSAP 3, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-pelp-pal-theme-motion-design.md`

## Global Constraints

- Use MUI as the component system and consume semantic theme values.
- GSAP must be imported only by `src/lib/animation/gsap.ts` and client-side wrappers.
- Respect `prefers-reduced-motion: reduce` by skipping non-essential JavaScript motion.
- Animate opacity and transforms only; do not animate inspection values, table cells, or evidence previews.
- Preserve keyboard accessibility and 44px touch targets.
- Keep route content usable immediately; motion must not delay interaction.
- Do not introduce a remote font dependency or a second component system.

---

### Task 1: Add the reusable password visibility field

**Files:**
- Create: `src/components/forms/password-field.tsx`
- Create: `tests/unit/password-field.test.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/features/auth/password-change-view.tsx`
- Modify: `src/features/personnel/personnel-view.tsx`

**Interfaces:**
- Produces `PasswordField`, a drop-in MUI `TextField` wrapper with the same supported props as `TextField` plus an optional `showPasswordLabel`.
- The control renders `type="password"` by default and toggles to `type="text"` without changing the field value.
- The toggle button exposes `aria-label="Show password"` or `aria-label="Hide password"` and has `type="button"`.

- [x] **Step 1: Write the failing component tests**

```tsx
it('keeps the password hidden by default and toggles visibility accessibly', async () => {
  render(<PasswordField label="Password" value="secret" onChange={() => {}} />);

  const input = screen.getByLabelText('Password');
  expect(input).toHaveAttribute('type', 'password');
  const toggle = screen.getByRole('button', { name: 'Show password' });

  await userEvent.click(toggle);
  expect(input).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/unit/password-field.test.tsx`

Expected: FAIL because `PasswordField` does not exist yet.

- [x] **Step 3: Implement the minimal `PasswordField` component**

Use MUI `InputAdornment` and `IconButton` with `VisibilityRounded` and `VisibilityOffRounded`. Forward all normal `TextField` props, merge an `endAdornment` supplied by the caller only when the password toggle is enabled, and preserve the caller’s `inputProps` and `slotProps`.

- [x] **Step 4: Replace password `TextField` usages**

Use `PasswordField` for the login password, both forced-change fields, personnel creation temporary password, and personnel reset temporary password. Keep `current-password` and `new-password` autocomplete values unchanged.

- [x] **Step 5: Run focused tests and verify they pass**

Run: `npm test -- --run tests/unit/password-field.test.tsx tests/unit/login.test.tsx tests/unit/auth/account-password.test.ts`

Expected: PASS with the visibility toggle covered and existing authentication behavior unchanged.

### Task 2: Expand the GSAP animation boundary

**Files:**
- Modify: `src/lib/animation/gsap.ts`
- Modify: `tests/unit/animation/gsap.test.ts`
- Modify: `src/theme/tokens.ts`

**Interfaces:**
- `fadeUp(target: Element | null, options?: { delay?: number }): AnimationCleanup`
- `staggerIn(targets: Element[] | NodeListOf<Element>, options?: { delay?: number }): AnimationCleanup`
- `slidePanel(target: Element | null, direction?: 'left' | 'right'): AnimationCleanup`
- `stateFeedback(target: Element | null): AnimationCleanup`
- Every helper returns a no-op cleanup for null targets or reduced-motion users.

- [x] **Step 1: Add failing tests for reduced-motion and helper behavior**

Assert that `prefersReducedMotion()` follows `matchMedia`, that reduced motion prevents GSAP tween creation, and that each helper returns a callable cleanup for a valid element and a null element.

- [x] **Step 2: Run the animation tests and verify the new assertions fail**

Run: `npm test -- --run tests/unit/animation/gsap.test.ts`

Expected: FAIL for the new helper imports or behavior.

- [x] **Step 3: Add named motion tokens**

Extend `designTokens.motion` with a small stagger interval and panel distance, retaining the existing duration and easing values. Do not add page-specific magic numbers to components.

- [x] **Step 4: Implement the helpers with GSAP context cleanup**

Use `gsap.context` for every animation, animate only `autoAlpha`, `x`, and `y`, and return `context.revert` as the cleanup function. Use the standard duration for route entry, fast duration for state feedback, and the emphasized easing for panel transitions.

- [x] **Step 5: Run the animation tests and verify they pass**

Run: `npm test -- --run tests/unit/animation/gsap.test.ts`

Expected: PASS with no reduced-motion animation work performed.

### Task 3: Add the client-only animated route boundary

**Files:**
- Create: `src/components/motion/animated-route.tsx`
- Create: `tests/unit/animated-route.test.tsx`
- Modify: `src/app/(workspace)/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/enroll/page.tsx`

**Interfaces:**
- `AnimatedRoute({ children }: Readonly<{ children: ReactNode }>)` renders a wrapper with a stable ref and uses `usePathname()` plus `fadeUp()` in a client-side `requestAnimationFrame` scheduled from `useEffect`.
- The workspace layout mounts one `AnimatedRoute` around `{children}` after `SyncRuntimeBoundary`, so route changes animate once without remounting the app shell or sync runtime.

- [x] **Step 1: Write the failing route-boundary test**

Render `AnimatedRoute` with a mocked pathname and mocked `fadeUp`, then assert the wrapper renders its children and invokes `fadeUp` with its element after layout.

- [x] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/unit/animated-route.test.tsx`

Expected: FAIL because the wrapper does not exist.

- [x] **Step 3: Implement `AnimatedRoute`**

Use a client component, `useRef`, `useEffect`, and a pathname dependency. Schedule `fadeUp` after the first paint and clean up both the animation and pending frame. Keep the wrapper `minWidth: 0` and do not alter layout sizing.

- [x] **Step 4: Wrap workspace and public page content**

Use the route boundary for workspace children and wrap the landing, login, and enrollment page roots with the same helper. Do not add a second animation to existing views that already call `fadeUp`; those direct calls will be removed in Task 4 when the route boundary covers them.

- [x] **Step 5: Run the route test and verify it passes**

Run: `npm test -- --run tests/unit/animated-route.test.tsx`

Expected: PASS with cleanup invoked on unmount or pathname changes.

### Task 4: Consolidate existing view animations and add targeted panel motion

**Files:**
- Modify: `src/app/(workspace)/dashboard/dashboard-view.tsx`
- Modify: `src/app/(workspace)/lookup/lookup-view.tsx`
- Modify: `src/features/activity/activity-view.tsx`
- Modify: `src/features/summary/summary-view.tsx`
- Modify: `src/features/report/report-view.tsx`
- Modify: `src/features/sync/sync-view.tsx`
- Modify: `src/features/account/account-view.tsx`
- Modify: `src/features/personnel/personnel-view.tsx`
- Modify: `src/features/store/store-form.tsx`
- Modify: `src/features/inspection/inspection-editor.tsx`
- Modify: `src/features/lookup/qr-scanner-dialog.tsx`

**Interfaces:**
- Route entry motion comes only from `AnimatedRoute`.
- `staggerIn` remains available for repeated, meaningful panel/card groups without hiding critical navigation.
- `slidePanel` is used for QR scanner dialog content.
- `stateFeedback` is used for password-change error feedback only when a stable target exists.

- [x] **Step 1: Update affected view tests with motion-boundary mocks**

Keep tests deterministic by mocking the boundary helpers to return no-op cleanups. Preserve existing assertions for inspection, sync, catalog, summary, and account behavior.

- [x] **Step 2: Run affected view tests and capture any baseline failures**

Run: `npm test -- --run tests/unit/dashboard.test.tsx tests/unit/lookup.test.tsx tests/unit/activity.test.tsx tests/unit/summary.test.tsx tests/unit/sync/sync-view.test.tsx tests/unit/account.test.tsx`

Expected: Existing behavior remains green before motion changes.

- [x] **Step 3: Remove duplicate page-level `fadeUp` effects**

Delete the direct page-entry `fadeUp` refs from dashboard, lookup, activity, and summary so the shared route boundary is the single page-entry animation.

- [x] **Step 4: Add targeted stagger and panel transitions**

Attach a ref to the QR scanner dialog content and call `slidePanel` after the dialog mounts. Keep critical navigation visible and ensure the inspector’s product data and evidence image remain static except for existing zoom behavior.

- [x] **Step 5: Run affected view tests and verify they pass**

Run the command from Step 2 again. Expected: PASS with no changed user-facing behavior other than motion.

### Task 5: Document the final motion and password patterns

**Files:**
- Modify: `public/system-theme.md`

- [x] **Step 1: Document the password field contract**

Describe the shared field, default hidden state, accessible labels, and autocomplete rules.

- [x] **Step 2: Document the final GSAP helper API**

Update the Motion section with `fadeUp`, `staggerIn`, `slidePanel`, and `stateFeedback`, including the reduced-motion and cleanup requirements.

- [x] **Step 3: Check the documentation against the implementation**

Run: `rg -n "PasswordField|fadeUp|staggerIn|slidePanel|stateFeedback|prefersReducedMotion" src public/system-theme.md`

Expected: Every documented symbol exists at the documented path.

### Task 6: Full verification

**Files:**
- No production file changes; verification only.

- [x] **Step 1: Run all unit tests**

Run: `npm test`

- [x] **Step 2: Run static checks**

Run: `npm run lint` and `npm run typecheck`

- [x] **Step 3: Run browser and responsive checks**

Run: `npm run test:e2e`

Expected: Signed-out route guards still redirect to login, password fields remain usable on phones, and the mobile shell has no overflow.

- [x] **Step 4: Run the production build**

Run: `npm run build`

Expected: The client-only GSAP boundary is not imported into server-only code and the build completes successfully.
