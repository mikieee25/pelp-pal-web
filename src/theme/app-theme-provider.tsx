'use client';

import { ThemeProvider } from '@mui/material/styles';
import { useEffect } from 'react';
import { appTheme } from './theme';

export function AppThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
        await Promise.all(
          registrations
            .filter((registration) => {
              const workerUrl =
                registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL;
              return workerUrl?.endsWith('/sw.js');
            })
            .map((registration) => registration.unregister()),
        );

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith('pelp-pal-static-'))
              .map((cacheName) => caches.delete(cacheName)),
          );
        }
      });
      return;
    }

    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  }, []);

  return <ThemeProvider theme={appTheme}>{children}</ThemeProvider>;
}
