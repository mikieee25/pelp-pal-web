import type { Metadata, Viewport } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { AppThemeProvider } from '@/theme/app-theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'PELP Pal',
  description: 'Offline-first PELP Pal inspection workspace.',
  robots: { index: false, follow: false, noarchive: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <AppThemeProvider>{children}</AppThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
