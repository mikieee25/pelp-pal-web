'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';

const navigation = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Lookup', href: '/lookup' },
  { label: 'Activity', href: '/activity' },
  { label: 'Summary', href: '/summary' },
  { label: 'Sync', href: '/sync' },
  { label: 'Account', href: '/account' },
];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? '';
  const selected = navigation.find((item) => pathname.startsWith(item.href))?.href ?? '/dashboard';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', pb: { xs: 8, md: 0 } }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', display: { xs: 'block', md: 'none' } }}>
        <Toolbar><Typography variant="h6" fontWeight={700}>PELP Pal</Typography></Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ display: { xs: 'none', md: 'block' }, width: 240, '& .MuiDrawer-paper': { width: 240, boxSizing: 'border-box' } }}>
        <Toolbar><Typography variant="h6" fontWeight={700}>PELP Pal</Typography></Toolbar>
        <List component="nav" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <ListItemButton key={item.href} component={Link} href={item.href} selected={selected === item.href}>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
      <Box component="main" sx={{ flex: 1, pt: { xs: 9, md: 0 } }}>{children}</Box>
      <BottomNavigation showLabels value={selected} sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: { xs: 'flex', md: 'none' }, borderTop: 1, borderColor: 'divider', zIndex: 1200 }}>
        {navigation.slice(0, 4).map((item) => (
          <BottomNavigationAction key={item.href} component={Link} href={item.href} label={item.label} value={item.href} aria-label={item.label} />
        ))}
      </BottomNavigation>
    </Box>
  );
}
