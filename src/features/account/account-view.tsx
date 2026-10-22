'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, Copy, KeyRound, LogOut, RefreshCw } from 'lucide-react';
import { clearLocalSession } from '@/lib/auth/local-session-store';
import { clearVerifiedOfflineAccount } from '@/lib/auth/offline-account';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getCurrentAccount, type CurrentAccount } from '@/features/auth/account-password';
import { CatalogManagementPanel } from './catalog-management-panel';
import packageInfo from '../../../package.json';
import { ActionBar, InlineNotice, KeyValueList, PageHeader, PageShell, Section, StatusBadge, Surface } from '@/components/ui';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';

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
  const [supportOpen, setSupportOpen] = useState(false);

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
    clearVerifiedOfflineAccount();

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
      <div className="space-y-8">
        <PageHeader title="Account" subtitle="Manage the signed-in personnel account and its shared workspace access." />

        {error && <InlineNotice severity="error">{error}</InlineNotice>}

        <Section title="Account details">
          <Surface className="px-4 sm:px-6">
            <KeyValueList items={[
              { label: 'Signed-in account', value: loading ? 'Loading…' : displayUsername },
              { label: 'Role', value: loading ? 'Loading…' : formatRole(account?.role) },
              { label: 'Catalog access', value: loading ? 'Loading…' : formatCatalogScope(account?.role) },
            ]} />
          </Surface>
        </Section>

        <Section title="Sync access">
          <Surface className="space-y-5 p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <KeyRound aria-hidden="true" className="size-5 shrink-0 text-primary" />
                <p className="flex-1 text-sm text-muted">
                  {loading
                    ? 'Checking account access…'
                    : account?.isActive
                      ? 'This account is active and ready to sync on any signed-in browser.'
                      : 'This account is inactive. Shared sync is unavailable.'}
                </p>
                {!loading && <StatusBadge variant={account?.isActive ? 'synced' : 'attention'} label={account?.isActive ? 'Active' : 'Inactive'} />}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/sync" className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary sm:w-auto"><RefreshCw aria-hidden="true" className="size-4" />
                  View sync status
                </Link>
                <p className="flex-1 text-sm text-muted">
                  Sign in on another browser with this account to continue the same shared workspace.
                </p>
              </div>
          </Surface>
        </Section>

        {!loading && account?.isActive && account.role === 'admin' && <CatalogManagementPanel />}

        <Section title="Sign out">
          <p className="mb-3 text-sm text-muted">Sign out of this browser and clear its local session.</p>
          <ActionBar>
            <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-ink disabled:opacity-60"><LogOut aria-hidden="true" className="size-4" />{signingOut ? 'Signing out…' : 'Sign out'}</button>
          </ActionBar>
        </Section>

        <AnimatedDisclosure id="account-support-content" testId="account-support-info" open={supportOpen} onOpenChange={setSupportOpen} className="rounded-xl border border-border bg-white" summaryClassName="flex min-h-14 w-full items-center justify-between px-4 text-left font-semibold text-ink focus-visible:outline-2 focus-visible:outline-focus" summary={<>Support info<ChevronDown aria-hidden="true" className={`size-4 transition-transform motion-reduce:transition-none ${supportOpen ? 'rotate-180' : ''}`} /></>} panelClassName="overflow-hidden border-t border-border p-4">
              <KeyValueList items={[
                { label: 'Organization ID', value: account?.organizationId ?? 'Not assigned', mono: true },
                { label: 'App version', value: packageInfo.version },
                ...(commit ? [{ label: 'Commit', value: commit.slice(0, 12), mono: true }] : []),
              ]} />
              <button type="button" onClick={() => void copyOrganizationId()} disabled={!account?.organizationId} aria-label="Copy organization ID" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong px-4 font-semibold text-primary disabled:opacity-60"><Copy aria-hidden="true" className="size-4" />
                Copy organization ID
              </button>
              {copyFeedback && <p role="status" className="text-sm text-muted">{copyFeedback}</p>}
        </AnimatedDisclosure>
      </div>
    </PageShell>
  );
}
