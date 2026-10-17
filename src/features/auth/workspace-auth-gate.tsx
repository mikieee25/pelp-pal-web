'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearLocalSession, getLocalSession } from '@/lib/auth/local-session-store';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getCurrentAccount } from './account-password';

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
      clearLocalSession();
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

    void client.auth.getUser()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          if (getLocalSession() && isTransientAuthError(error)) {
            setStatus('authenticated');
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
          if (getLocalSession() && isTransientAuthError(accountError)) {
            setStatus('authenticated');
            return;
          }
          throw accountError;
        }
        if (account.isActive === false) {
          await client.auth.signOut({ scope: 'local' });
          redirectToLogin();
          return;
        }
        if (account.mustChangePassword && pathname !== '/change-password') {
          setStatus('redirecting');
          router.replace(`/change-password?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        setStatus('authenticated');
      })
      .catch((error) => {
        if (getLocalSession() && isTransientAuthError(error)) {
          setStatus('authenticated');
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

function isTransientAuthError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /failed to fetch|network|offline|timeout|unavailable|connection|fetch failed/.test(message);
}
