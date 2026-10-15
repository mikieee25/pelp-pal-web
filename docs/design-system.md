# PELP Pal design system

MUI remains the component foundation. Use `src/theme/tokens.ts` as the source for shared color, type, spacing, radius, motion, and layout values; `src/theme/theme.ts` adapts those values to MUI. Prefer theme variants and semantic tokens over one-off colors or spacing.

## Tokens

- Colors: white page/surface, neutral alternate surface, ink/muted text, border strengths, and primary/success/warning/danger pairs with soft backgrounds.
- Spacing: 4 px base. Radii: 8 px small, 12 px surface, 10 px controls, and 16 px dialogs.
- Type: 12/16 caption, 14/20 body, 16/24 large body, 20/28 title, and 28/34 display. Numeric values use tabular figures. Use the system monospace stack at 13 px for identifiers.
- Motion: keep GSAP transitions on the shared motion tokens and skip them when `prefers-reduced-motion` is enabled.

## Primitives (`src/components/ui`)

- `PageShell`: responsive page padding and a 960 px reading width.
- `PageHeader`: page title with optional subtitle and actions; avoid decorative all-caps eyebrow text.
- `Section`: semantic section title and hairline divider, without a card wrapper.
- `Surface`: bordered, flat surface. Use this as the only reusable card treatment.
- `ListRow`: 56 px minimum row for primary/secondary content and optional leading, trailing, chevron, and whole-row action.
- `Stat`: value and label with tabular numerals.
- `StatusBadge`: icon plus readable text for compliant, non-compliant, synced, waiting, attention, or neutral status. Do not communicate status by color alone.
- `EmptyState`: icon, one-line message, and optional action for an empty area.
- `InlineNotice`: compact inline alert for contextual feedback.
- `ActionBar`: sticky, safe-area-aware action region on phones and inline on larger screens.
- `KeyValueList`: aligned definition list for account and operational details; use `mono` for IDs.

Use MUI directly for controls not covered by these primitives. Apply the primitives to a screen when it is being migrated; do not rework unrelated screens solely to adopt the new API.
