'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import { clearLocalSession } from '@/lib/auth/local-session-store';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getCurrentAccount, type CurrentAccount } from '@/features/auth/account-password';
import { CatalogManagementPanel } from './catalog-management-panel';
import { PageContainer, PageHeader } from '@/components/layout/page-layout';

function formatRole(role: string | undefined): string {
  if (role === 'epred') return 'EPRED inspector';
  if (role === 'admin') return 'Administrator';
  if (role === 'guest') return 'Guest';
  return 'Not assigned';
}

function formatCatalogScope(role: string | undefined): string {
  return role === 'guest' ? 'Guest catalog' : 'Master catalog';
}

export function AccountView() {
  const router = useRouter();
  const [account, setAccount] = useState<CurrentAccount>();
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getCurrentAccount()
      .then((current) => {
        if (!active) return;
        setAccount(current);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('We could not read this browser’s account status.');
        setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);
    clearLocalSession();

    try {
      const { error: signOutError } = await getSupabaseBrowserClient().auth.signOut();
      if (signOutError) throw signOutError;
    } catch {
      setError('Signed out on this browser, but the online session could not be closed.');
    } finally {
      router.replace('/login');
    }
  };

  const displayUsername = account?.username ?? 'Account not found';

  return (
    <PageContainer maxWidth="md">
      <PageHeader eyebrow="Account" title="Account" subtitle="Manage the signed-in personnel account and its shared workspace access." />

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Stack spacing={2}>
        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  bgcolor: 'action.hover',
                  color: 'primary.main',
                  flexShrink: 0,
                }}
              >
                <VpnKeyOutlinedIcon />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="overline" color="primary.main" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>
                  Signed-in account
                </Typography>
                <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>
                  {loading ? 'Loading account…' : displayUsername}
                </Typography>
              </Box>
            </Stack>
            <Divider />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 1.5, sm: 4 }}
              divider={<Divider orientation="vertical" flexItem />}
            >
              <Box>
                <Typography variant="caption" color="text.secondary">Role</Typography>
                <Typography fontWeight={600}>{loading ? 'Loading…' : formatRole(account?.role)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Catalog access</Typography>
                <Typography fontWeight={600}>{loading ? 'Loading…' : formatCatalogScope(account?.role)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Organization</Typography>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                  {loading ? 'Loading…' : account?.organizationId ?? 'Not assigned'}
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </Paper>

        <Paper sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  bgcolor: account?.isActive ? 'success.50' : 'warning.50',
                  color: account?.isActive ? 'success.main' : 'warning.dark',
                  flexShrink: 0,
                }}
              >
                <VpnKeyOutlinedIcon />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="h6">Sync access</Typography>
                <Typography color="text.secondary" variant="body2">
                  {loading
                    ? 'Checking account access…'
                    : account?.isActive
                      ? 'This account is active and ready to sync on any signed-in browser.'
                      : 'This account is inactive. Shared sync is unavailable.'}
                </Typography>
              </Box>
              {!loading && <Chip label={account?.isActive ? 'Active' : 'Inactive'} color={account?.isActive ? 'success' : 'warning'} size="small" />}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button component={Link} href="/sync" variant="outlined" startIcon={<SyncOutlinedIcon />} fullWidth>
                View sync status
              </Button>
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                Sign in on another browser with this account to continue the same shared workspace.
              </Typography>
            </Stack>
          </Stack>
        </Paper>

        {!loading && account?.isActive && account.role === 'admin' && <CatalogManagementPanel />}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            color="inherit"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            startIcon={<LogoutOutlinedIcon />}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Box>
      </Stack>
    </PageContainer>
  );
}
