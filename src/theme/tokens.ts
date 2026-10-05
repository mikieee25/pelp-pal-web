export const designTokens = {
  colors: {
    canvas: '#f7f9fb',
    surface: '#ffffff',
    ink: '#17212b',
    muted: '#5f6b76',
    primary: '#0b5cab',
    primaryDark: '#073e73',
    border: '#d7dee6',
    success: '#18794e',
    warning: '#9a6700',
    danger: '#b42318',
    focus: '#0b5cab',
  },
  radius: { sm: 8, md: 12, lg: 16 },
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
} as const;
