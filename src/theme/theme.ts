import { createTheme } from '@mui/material/styles';
import { designTokens } from './tokens';

export const appTheme = createTheme({
  spacing: 4,
  palette: {
    mode: 'light',
    primary: { main: designTokens.colors.primary, dark: designTokens.colors.primaryHover },
    background: { default: designTokens.colors.canvas, paper: designTokens.colors.surface },
    text: { primary: designTokens.colors.ink, secondary: designTokens.colors.muted },
    divider: designTokens.colors.border,
    info: { main: designTokens.colors.focus },
    success: { main: designTokens.colors.success },
    warning: { main: designTokens.colors.warning },
    error: { main: designTokens.colors.danger },
  },
  shape: { borderRadius: designTokens.radius.control },
  typography: {
    fontFamily: designTokens.typography.fontFamily,
    fontSize: designTokens.typography.body.fontSize,
    h1: { fontSize: designTokens.typography.display.fontSize, lineHeight: designTokens.typography.display.lineHeight, fontWeight: designTokens.typography.display.fontWeight },
    h2: { fontSize: designTokens.typography.title.fontSize, lineHeight: designTokens.typography.title.lineHeight, fontWeight: designTokens.typography.title.fontWeight },
    h3: { fontSize: designTokens.typography.title.fontSize, lineHeight: designTokens.typography.title.lineHeight, fontWeight: designTokens.typography.title.fontWeight },
    h4: { fontSize: designTokens.typography.title.fontSize, lineHeight: designTokens.typography.title.lineHeight, fontWeight: designTokens.typography.title.fontWeight },
    h5: { fontSize: designTokens.typography.bodyLg.fontSize, lineHeight: designTokens.typography.bodyLg.lineHeight, fontWeight: 600 },
    h6: { fontSize: designTokens.typography.bodyLg.fontSize, lineHeight: designTokens.typography.bodyLg.lineHeight, fontWeight: 600 },
    body1: { fontSize: designTokens.typography.body.fontSize, lineHeight: designTokens.typography.body.lineHeight },
    body2: { fontSize: designTokens.typography.body.fontSize, lineHeight: designTokens.typography.body.lineHeight },
    caption: { fontSize: designTokens.typography.caption.fontSize, lineHeight: designTokens.typography.caption.lineHeight },
    button: { fontSize: designTokens.typography.body.fontSize, fontWeight: 600, textTransform: 'none' },
  },
  components: {
    // MUI menus and dialogs otherwise lock the body and add scrollbar-width
    // compensation. That compensation shifts the entire workspace sideways
    // whenever a Select is opened, especially noticeable on mobile.
    MuiModal: { defaultProps: { disableScrollLock: true } },
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontVariantNumeric: 'tabular-nums' },
        'code, kbd, samp, .mono': { fontFamily: designTokens.typography.monoFontFamily, fontSize: `${designTokens.typography.monoSize}px` },
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: designTokens.layout.touchTarget, borderRadius: designTokens.radius.control, boxShadow: 'none', fontWeight: 600, textTransform: 'none' },
        contained: { '&:hover': { boxShadow: 'none' } },
        containedPrimary: { '&:hover': { backgroundColor: designTokens.colors.primaryHover } },
        outlined: { borderColor: designTokens.colors.borderStrong, '&:hover': { borderColor: designTokens.colors.ink, backgroundColor: designTokens.colors.surfaceAlt } },
      },
    },
    MuiTextField: { defaultProps: { size: 'medium' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: 48, borderRadius: designTokens.radius.control, fontSize: 16, '& .MuiOutlinedInput-notchedOutline': { borderColor: designTokens.colors.borderStrong }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: designTokens.colors.ink }, '&.Mui-focused': { outline: `2px solid ${designTokens.colors.primary}`, outlineOffset: 1 }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: designTokens.colors.primary, borderWidth: 2 } },
        input: { fontSize: 16, lineHeight: '24px' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', border: `1px solid ${designTokens.colors.border}` } } },
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: `1px solid ${designTokens.colors.border}`, borderRadius: designTokens.radius.md } } },
    MuiChip: { styleOverrides: { root: { borderRadius: designTokens.radius.sm }, sizeSmall: { height: 24, borderColor: 'transparent' }, labelSmall: { paddingLeft: 8, paddingRight: 8, fontSize: 12 } } },
    MuiAlert: {
      styleOverrides: {
        root: { alignItems: 'center', padding: '4px 12px', borderRadius: designTokens.radius.sm, borderLeft: '3px solid' },
        standardInfo: { color: designTokens.colors.ink, backgroundColor: designTokens.colors.primarySoft, borderLeftColor: designTokens.colors.primary },
        standardSuccess: { color: designTokens.colors.ink, backgroundColor: designTokens.colors.successSoft, borderLeftColor: designTokens.colors.success },
        standardWarning: { color: designTokens.colors.ink, backgroundColor: designTokens.colors.warningSoft, borderLeftColor: designTokens.colors.warning },
        standardError: { color: designTokens.colors.ink, backgroundColor: designTokens.colors.dangerSoft, borderLeftColor: designTokens.colors.danger },
      },
    },
    MuiDialog: { styleOverrides: { container: { '@media (max-width:599.95px)': { alignItems: 'stretch' } }, paper: { borderRadius: designTokens.radius.dialog, boxShadow: '0 12px 32px rgba(17, 24, 39, 0.16)', '@media (max-width:599.95px)': { width: '100%', maxWidth: '100%', height: '100dvh', maxHeight: '100dvh', margin: 0, borderRadius: `${designTokens.radius.dialog}px ${designTokens.radius.dialog}px 0 0` } } } },
    MuiMenu: { styleOverrides: { paper: { boxShadow: '0 8px 24px rgba(17, 24, 39, 0.16)' } } },
    MuiPopover: { styleOverrides: { paper: { boxShadow: '0 8px 24px rgba(17, 24, 39, 0.16)' } } },
    MuiDrawer: { styleOverrides: { paper: { boxShadow: 'none' } } },
    MuiTooltip: { styleOverrides: { tooltip: { boxShadow: 'none' } } },
    MuiToggleButtonGroup: { styleOverrides: { root: { border: `1px solid ${designTokens.colors.border}`, borderRadius: designTokens.radius.sm, padding: 2 }, grouped: { border: 0, borderRadius: `${designTokens.radius.sm - 2}px !important`, '&.Mui-selected': { backgroundColor: designTokens.colors.primarySoft, color: designTokens.colors.primary } } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 }, indicator: { display: 'none' } } },
    MuiTab: { styleOverrides: { root: { minHeight: 44, borderRadius: designTokens.radius.sm, textTransform: 'none', '&.Mui-selected': { color: designTokens.colors.primary, backgroundColor: designTokens.colors.primarySoft } } } },
    MuiAccordion: { styleOverrides: { root: { border: 0, borderRadius: 0, backgroundColor: 'transparent', boxShadow: 'none', '&:before': { backgroundColor: designTokens.colors.border } } } },
    MuiLinearProgress: { styleOverrides: { root: { height: 3, borderRadius: 3, backgroundColor: designTokens.colors.surfaceAlt }, bar: { borderRadius: 3 } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: designTokens.colors.surfaceAlt } } },
    MuiBottomNavigationAction: {
      styleOverrides: { root: { minHeight: designTokens.layout.touchTarget, minWidth: 0, padding: '6px 4px', fontSize: 11, borderRadius: designTokens.radius.sm, margin: 4, '&.Mui-selected': { color: designTokens.colors.primary, backgroundColor: designTokens.colors.primarySoft } }, label: { fontSize: 11, '&.Mui-selected': { fontSize: 11, fontWeight: 600 } } },
    },
  },
});
