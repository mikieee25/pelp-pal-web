'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AppBar,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import {
  CloseRounded,
  CloudDoneRounded,
  DashboardRounded,
  HistoryRounded,
  ManageAccountsRounded,
  MenuRounded,
  PeopleAltRounded,
  SearchRounded,
  SummarizeRounded,
  AssignmentRounded,
  SyncRounded,
} from '@mui/icons-material';
import { designTokens } from '@/theme/tokens';
import { getBrowserRepository } from '@/lib/db/browser';
import type { DeviceRecord } from '@/lib/db/records';

const navigation = [
  { label: 'Dashboard', href: '/dashboard', icon: <DashboardRounded fontSize="small" /> },
  { label: 'Lookup', href: '/lookup', icon: <SearchRounded fontSize="small" /> },
  { label: 'Activity', href: '/activity', icon: <HistoryRounded fontSize="small" /> },
  { label: 'Summary', href: '/summary', icon: <SummarizeRounded fontSize="small" /> },
  { label: 'Report', href: '/report', icon: <AssignmentRounded fontSize="small" /> },
  { label: 'Sync', href: '/sync', icon: <SyncRounded fontSize="small" /> },
  { label: 'Personnel', href: '/personnel', icon: <PeopleAltRounded fontSize="small" /> },
  { label: 'Account', href: '/account', icon: <ManageAccountsRounded fontSize="small" /> },
] as const;

const primaryNavigation = navigation.slice(0, 4);

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname() ?? '';
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [deviceLoaded, setDeviceLoaded] = useState(false);
  const selected = navigation.find((item) => pathname.startsWith(item.href))?.href ?? '/dashboard';
  const canManagePersonnel = deviceLoaded && device?.enrolled === true && device.assignedRole === 'admin' && !device.revokedAt;

  useEffect(() => {
    let active = true;
    void getBrowserRepository().getDevice().then((current) => {
      if (active) {
        setDevice(current ?? null);
        setDeviceLoaded(true);
      }
    }).catch(() => {
      if (active) setDeviceLoaded(true);
    });
    return () => { active = false; };
  }, []);

  return (
    <Box
      className="app-shell"
      sx={{
        display: 'flex',
        minHeight: '100dvh',
        bgcolor: 'background.default',
        pb: { xs: `calc(${designTokens.layout.mobileNavigationHeight}px + env(safe-area-inset-bottom))`, md: 0 },
      }}
    >
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          display: { xs: 'block', md: 'none' },
          pt: 'env(safe-area-inset-top)',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ minHeight: designTokens.layout.mobileNavigationHeight, justifyContent: 'space-between', px: { xs: 2, sm: 3 } }}>
          <Brand compact />
          <IconButton aria-label="Open workspace menu" onClick={() => setIsMenuOpen(true)} color="primary">
            <MenuRounded />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: designTokens.layout.navigationWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: designTokens.layout.navigationWidth,
            boxSizing: 'border-box',
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
        }}
      >
        <Toolbar sx={{ px: 3 }}><Brand /></Toolbar>
        <Divider />
        <Box sx={{ px: 1.5, py: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, fontWeight: 800, letterSpacing: '0.08em' }}>
            Workspace
          </Typography>
          <NavigationList selected={selected} canManagePersonnel={canManagePersonnel} />
        </Box>
        <Box sx={{ mt: 'auto', p: 2 }}><LocalFirstCard /></Box>
      </Drawer>

      <Drawer
        anchor="right"
        open={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: { xs: 'min(88vw, 340px)', sm: 340 }, p: 2 } }}
      >
        <Stack spacing={2} sx={{ height: '100%' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1 }}>
            <Brand compact />
            <IconButton aria-label="Close workspace menu" onClick={() => setIsMenuOpen(false)}>
              <CloseRounded />
            </IconButton>
          </Stack>
          <Divider />
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, fontWeight: 800, letterSpacing: '0.08em' }}>
              Workspace
            </Typography>
            <NavigationList selected={selected} canManagePersonnel={canManagePersonnel} onNavigate={() => setIsMenuOpen(false)} />
          </Box>
          <Box sx={{ mt: 'auto' }}><LocalFirstCard /></Box>
        </Stack>
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0, pt: { xs: `calc(${designTokens.layout.mobileNavigationHeight}px + env(safe-area-inset-top))`, md: 0 } }}>
        {children}
      </Box>

      <BottomNavigation
        showLabels
        value={selected}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          display: { xs: 'flex', md: 'none' },
          minHeight: designTokens.layout.mobileNavigationHeight,
          pb: 'env(safe-area-inset-bottom)',
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          zIndex: 1200,
        }}
      >
        {primaryNavigation.map((item) => (
          <BottomNavigationAction key={item.href} component={Link} href={item.href} label={item.label} value={item.href} icon={item.icon} aria-label={item.label} />
        ))}
      </BottomNavigation>
    </Box>
  );
}

function NavigationList({ selected, canManagePersonnel, onNavigate }: { selected: string; canManagePersonnel: boolean; onNavigate?: () => void }) {
  return (
    <List component="nav" aria-label="Workspace navigation" sx={{ pt: 1 }}>
      {navigation.filter((item) => item.href !== '/personnel' || canManagePersonnel).map((item) => (
        <ListItemButton
          key={item.href}
          component={Link}
          href={item.href}
          selected={selected === item.href}
          onClick={onNavigate}
          sx={{
            minHeight: designTokens.layout.touchTarget,
            mb: 0.5,
            borderRadius: 2,
            '&.Mui-selected': { bgcolor: 'action.selected', color: 'primary.main' },
          }}
        >
          <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: selected === item.href ? 700 : 500 }} />
        </ListItemButton>
      ))}
    </List>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 36, height: 36, flexShrink: 0, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
        <Typography variant="subtitle1" fontWeight={800}>P</Typography>
      </Box>
      <Box sx={{ minWidth: 0, display: compact ? { xs: 'block', md: 'none' } : 'block' }}>
        <Typography variant="subtitle1" fontWeight={800} noWrap>PELP Pal</Typography>
        <Typography variant="caption" color="text.secondary" noWrap>Inspection workspace</Typography>
      </Box>
    </Stack>
  );
}

function LocalFirstCard() {
  return (
    <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: 'action.hover', border: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1.25} alignItems="flex-start">
        <CloudDoneRounded color="primary" fontSize="small" sx={{ mt: 0.25 }} />
        <Box>
          <Typography variant="body2" fontWeight={700}>Local-first mode</Typography>
          <Typography variant="caption" color="text.secondary">Your field work stays available offline.</Typography>
        </Box>
      </Stack>
    </Box>
  );
}
