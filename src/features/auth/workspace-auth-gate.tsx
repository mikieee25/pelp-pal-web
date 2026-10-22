'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearLocalSession, getLocalSession } from '@/lib/auth/local-session-store';
import { saveLocalSession } from '@/lib/auth/local-session-store';
import { getBrowserRepository } from '@/lib/db/browser';
import type { AccountScope, CatalogRole } from '@/lib/db/records';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getCurrentAccount } from './account-password';
import { clearVerifiedOfflineAccount, readVerifiedOfflineAccount, saveVerifiedOfflineAccount } from '@/lib/auth/offline-account';

type AuthGateStatus = 'checking' | 'authenticated' | 'redirecting';

export function sanitizeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/dashboard';
  }

  try {
    const parsed = new URL(value, 'https://pelp-pal.local');
    if (parsed.origin !== 'https://pelp-pal.local') return '/dashboard';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/dashboard';
  }
}

export function WorkspaceAuthGate({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<AuthGateStatus>('checking');
  const query = searchParams.toString();
  const nextPath = useMemo(() => {
    return sanitizeNextPath(`${pathname}${query ? `?${query}` : ''}`);
  }, [pathname, query]);

  useEffect(() => {
    let active = true;
    const redirectToLogin = () => {
      if (!active) return;
      getBrowserRepository().setAccountScope(undefined);
      clearLocalSession();
      clearVerifiedOfflineAccount();
      setStatus('redirecting');
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
    };

    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      redirectToLogin();
      return () => { active = false; };
    }

    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') redirectToLogin();
    });

    if (navigator.onLine === false) {
      const local = getLocalSession();
      queueMicrotask(() => {
        if (!active) return;
        const saved = local?.authUserId && readVerifiedOfflineAccount(local.authUserId, local.username);
        if (saved) {
          activateLocalAccountScope({ accountId: saved.accountId, organizationId: saved.organizationId, key: saved.key }, saved.role === 'guest' ? 'guestlist' : 'masterlist');
          setStatus('authenticated');
        } else redirectToLogin();
      });
      return () => { active = false; authListener.subscription.unsubscribe(); };
    }

    const allowVerifiedOfflineSession = async () => {
      if (!active) return;
      const local = getLocalSession();
      const saved = local?.authUserId && readVerifiedOfflineAccount(local.authUserId, local.username);
      if (saved) {
        activateLocalAccountScope({ accountId: saved.accountId, organizationId: saved.organizationId, key: saved.key }, saved.role === 'guest' ? 'guestlist' : 'masterlist');
        setStatus('authenticated');
      } else redirectToLogin();
    };

    void client.auth.getUser()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          if (isTransientAuthError(error)) {
            await allowVerifiedOfflineSession();
            return;
          }
          redirectToLogin();
          return;
        }
        if (!data.user) {
          redirectToLogin();
          return;
        }

        let account;
        try {
          account = await getCurrentAccount(client);
        } catch (accountError) {
          if (isTransientAuthError(accountError)) {
            await allowVerifiedOfflineSession();
            return;
          }
          throw accountError;
        }
        if (account.isActive === false) {
          await client.auth.signOut({ scope: 'local' });
          redirectToLogin();
          return;
        }
        if (!account.mustChangePassword) saveVerifiedOfflineAccount({
          id: account.id,
          organization_id: account.organizationId,
          username: account.username,
          role: account.role,
          is_active: account.isActive,
          must_change_password: account.mustChangePassword,
        }, data.user.id);
        if (!account.mustChangePassword) saveLocalSession(account.username, data.user.id);
        if (account.mustChangePassword && pathname !== '/change-password') {
          setStatus('redirecting');
          router.replace(`/change-password?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        activateLocalAccountScope(
          { accountId: account.id, organizationId: account.organizationId, key: `${account.organizationId}:${account.id}` },
          account.role === 'guest' ? 'guestlist' : 'masterlist',
        );
        setStatus('authenticated');
      })
      .catch((error) => {
        if (isTransientAuthError(error)) {
          void allowVerifiedOfflineSession();
          return;
        }
        redirectToLogin();
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [nextPath, pathname, router]);

  if (status === 'authenticated') return children;

  return <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center" role="status" aria-live="polite"><span role="progressbar" aria-label="Checking account access" className="size-8 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" /><p className="text-sm text-muted">{status === 'redirecting' ? 'Redirecting to sign in…' : 'Checking account access…'}</p></div>;
}

function activateLocalAccountScope(scope: AccountScope, catalogRole: CatalogRole): void {
  const repository = getBrowserRepository();
  repository.setAccountScope(scope);
  repository.setCatalogRole(catalogRole);
}

function isTransientAuthError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /failed to fetch|network|offline|timeout|unavailable|connection|fetch failed/.test(message);
}
