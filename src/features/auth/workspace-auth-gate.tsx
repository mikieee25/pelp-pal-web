'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CircularProgress, Stack, Typography } from '@mui/material';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearLocalSession } from '@/lib/auth/local-session-store';
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
        if (error || !data.user) {
          redirectToLogin();
          return;
        }

        const account = await getCurrentAccount(client);
        if (account.mustChangePassword && pathname !== '/change-password') {
          setStatus('redirecting');
          router.replace(`/change-password?next=${encodeURIComponent(nextPath)}`);
          return;
        }
        setStatus('authenticated');
      })
      .catch(() => {
        redirectToLogin();
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [nextPath, pathname, router]);

  if (status === 'authenticated') return children;

  return (
    <Stack alignItems="center" justifyContent="center" minHeight="40vh" spacing={1} role="status" aria-live="polite">
      <CircularProgress aria-label="Checking account access" />
      <Typography color="text.secondary">
        {status === 'redirecting' ? 'Redirecting to sign in…' : 'Checking account access…'}
      </Typography>
    </Stack>
  );
}
