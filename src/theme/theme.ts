import { createTheme } from '@mui/material/styles';
import { designTokens } from './tokens';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: designTokens.colors.primary, dark: designTokens.colors.primaryDark },
    background: { default: designTokens.colors.canvas, paper: designTokens.colors.surface },
    text: { primary: designTokens.colors.ink, secondary: designTokens.colors.muted },
    divider: designTokens.colors.border,
    info: { main: designTokens.colors.focus },
    success: { main: designTokens.colors.success },
    warning: { main: designTokens.colors.warning },
    error: { main: designTokens.colors.danger },
  },
  shape: { borderRadius: designTokens.radius.md },
  typography: {
    fontFamily: designTokens.typography.fontFamily,
    h1: { fontWeight: 700 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: { styleOverrides: { root: { minHeight: designTokens.layout.touchTarget } } },
    MuiBottomNavigationAction: {
      styleOverrides: { root: { minHeight: designTokens.layout.touchTarget } },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
});
