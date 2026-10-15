'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import { clearLocalSession } from '@/lib/auth/local-session-store';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getCurrentAccount, type CurrentAccount } from '@/features/auth/account-password';
import { CatalogManagementPanel } from './catalog-management-panel';
import packageInfo from '../../../package.json';
import { ActionBar, KeyValueList, PageHeader, PageShell, Section, StatusBadge, Surface } from '@/components/ui';

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
  const [copyFeedback, setCopyFeedback] = useState('');

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

  const copyOrganizationId = async () => {
    if (!account?.organizationId) return;
    try {
      await navigator.clipboard.writeText(account.organizationId);
      setCopyFeedback('Organization ID copied.');
    } catch {
      setCopyFeedback('Could not copy the organization ID.');
    }
  };

  const displayUsername = account?.username ?? 'Account not found';
  const commit = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

  return (
    <PageShell>
      <Stack spacing={{ xs: 6, md: 8 }}>
        <PageHeader title="Account" subtitle="Manage the signed-in personnel account and its shared workspace access." />

        {error && <Alert severity="error">{error}</Alert>}

        <Section title="Account details">
          <Surface sx={{ px: { xs: 4, sm: 6 } }}>
            <KeyValueList items={[
              { label: 'Signed-in account', value: loading ? 'Loading…' : displayUsername },
              { label: 'Role', value: loading ? 'Loading…' : formatRole(account?.role) },
              { label: 'Catalog access', value: loading ? 'Loading…' : formatCatalogScope(account?.role) },
            ]} />
          </Surface>
        </Section>

        <Section title="Sync access">
          <Surface sx={{ p: { xs: 4, sm: 6 } }}>
            <Stack spacing={4}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
                <VpnKeyOutlinedIcon color="primary" aria-hidden />
                <Typography color="text.secondary" sx={{ flex: 1 }}>
                  {loading
                    ? 'Checking account access…'
                    : account?.isActive
                      ? 'This account is active and ready to sync on any signed-in browser.'
                      : 'This account is inactive. Shared sync is unavailable.'}
                </Typography>
                {!loading && <StatusBadge variant={account?.isActive ? 'synced' : 'attention'} label={account?.isActive ? 'Active' : 'Inactive'} />}
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
                <Button component={Link} href="/sync" variant="outlined" startIcon={<SyncOutlinedIcon />} fullWidth>
                  View sync status
                </Button>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  Sign in on another browser with this account to continue the same shared workspace.
                </Typography>
              </Stack>
            </Stack>
          </Surface>
        </Section>

        {!loading && account?.isActive && account.role === 'admin' && <CatalogManagementPanel />}

        <Section title="Sign out">
          <Typography color="text.secondary" sx={{ mb: 3 }}>Sign out of this browser and clear its local session.</Typography>
          <ActionBar>
            <Button
              color="inherit"
              variant="outlined"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              startIcon={<LogoutOutlinedIcon />}
              fullWidth
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </ActionBar>
        </Section>

        <Accordion disableGutters data-testid="account-support-info">
          <AccordionSummary expandIcon={<ExpandMoreRounded />}>
            <Typography variant="body1" fontWeight={600}>Support info</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={3}>
              <KeyValueList items={[
                { label: 'Organization ID', value: account?.organizationId ?? 'Not assigned', mono: true },
                { label: 'App version', value: packageInfo.version },
                ...(commit ? [{ label: 'Commit', value: commit.slice(0, 12), mono: true }] : []),
              ]} />
              <Button
                variant="outlined"
                startIcon={<ContentCopyRounded />}
                onClick={() => void copyOrganizationId()}
                disabled={!account?.organizationId}
                aria-label="Copy organization ID"
              >
                Copy organization ID
              </Button>
              {copyFeedback && <Typography role="status" variant="body2" color="text.secondary">{copyFeedback}</Typography>}
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Stack>
    </PageShell>
  );
}
