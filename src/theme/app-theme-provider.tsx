'use client';

import { ThemeProvider } from '@mui/material/styles';
import { useEffect } from 'react';
import { appTheme } from './theme';

export function AppThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  return <ThemeProvider theme={appTheme}>{children}</ThemeProvider>;
}
