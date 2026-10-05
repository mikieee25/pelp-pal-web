'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import { clearLocalSession, getLocalSession } from '@/lib/auth/local-session-store';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { DeviceRecord } from '@/lib/db/records';

type AccountState = {
  username: string | null;
  device: DeviceRecord | null;
};

function formatRole(role: DeviceRecord['assignedRole']): string {
  if (role === 'epred') return 'EPRED inspector';
  if (role === 'admin') return 'Administrator';
  if (role === 'guest') return 'Guest';
  return 'Not assigned';
}

function formatCatalogScope(scope: DeviceRecord['catalogScope']): string {
  if (scope === 'guestlist') return 'Guest catalog';
  if (scope === 'masterlist') return 'Master catalog';
  return 'Not assigned';
}

export function AccountView() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountState>({ username: null, device: null });
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getBrowserRepository().getDevice()
      .then((device) => {
        if (!active) return;
        const session = getLocalSession();
        setAccount({ username: session?.username ?? device?.assignedUsername ?? null, device: device ?? null });
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

  const device = account.device;
  const enrolled = device?.enrolled === true;
  const displayUsername = account.username ?? 'Account not found';

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Account</Typography>
        <Typography color="text.secondary">
          Manage the signed-in account and this browser’s access to local work.
        </Typography>
      </Stack>

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
                <Typography fontWeight={600}>{loading ? 'Loading…' : formatRole(device?.assignedRole)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Catalog access</Typography>
                <Typography fontWeight={600}>{loading ? 'Loading…' : formatCatalogScope(device?.catalogScope)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Organization</Typography>
                <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                  {loading ? 'Loading…' : device?.organizationId ?? 'Not assigned'}
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
                  bgcolor: enrolled ? 'success.50' : 'warning.50',
                  color: enrolled ? 'success.main' : 'warning.dark',
                  flexShrink: 0,
                }}
              >
                <DevicesOutlinedIcon />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="h6">Browser access</Typography>
                <Typography color="text.secondary" variant="body2">
                  {loading
                    ? 'Checking browser enrollment…'
                    : enrolled
                      ? 'This browser is enrolled and ready to sync.'
                      : 'This browser is not enrolled. Local work stays on this device until enrollment.'}
                </Typography>
              </Box>
              {!loading && <Chip label={enrolled ? 'Enrolled' : 'Not enrolled'} color={enrolled ? 'success' : 'warning'} size="small" />}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button component={Link} href="/sync" variant="outlined" startIcon={<SyncOutlinedIcon />} fullWidth>
                View sync status
              </Button>
              {!loading && !enrolled && (
                <Button component={Link} href="/enroll" variant="outlined" fullWidth>
                  Enroll this browser
                </Button>
              )}
            </Stack>
          </Stack>
        </Paper>

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
    </Container>
  );
}
