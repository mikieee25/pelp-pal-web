'use client';

import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { sanitizeNextPath } from '@/features/auth/workspace-auth-gate';
import { signInWithCredentials } from '@/lib/auth/local-session';
import { saveLocalSession } from '@/lib/auth/local-session-store';
import { PasswordField } from '@/components/forms/password-field';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { ActionBar, PageHeader, PageShell, Section } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <AnimatedRoute>
      <PageShell>
        <Stack spacing={3}>
          <PageHeader title="Sign in" subtitle="Use your PELP Pal personnel username and password." />
          <Box component="form" onSubmit={async (event) => {
        event.preventDefault();
        if (isSubmitting) return;

        setMessage(undefined);
        setIsSubmitting(true);
        const form = new FormData(event.currentTarget);
        const username = String(form.get('username') ?? '');
        const password = String(form.get('password') ?? '');
        try {
          const account = await signInWithCredentials(username, password);
          saveLocalSession(account.username);
          const nextPath = sanitizeNextPath(searchParams.get('next'));
          router.replace(
            account.must_change_password
              ? `/change-password?next=${encodeURIComponent(nextPath)}`
              : nextPath,
          );
        } catch {
          setMessage('Invalid credentials or unavailable sign-in service.');
        } finally {
          setIsSubmitting(false);
        }
          }}>
            <Stack spacing={3} sx={{ '& .MuiInputBase-input': { fontSize: '16px' } }}>
              <Section title="Account access">
                <Stack spacing={2}>
                  <TextField required name="username" label="Username" autoComplete="username" />
                  <PasswordField required name="password" label="Password" autoComplete="current-password" />
                  {message && <Alert severity="info">{message}</Alert>}
                </Stack>
              </Section>
              <ActionBar>
                <Button type="submit" variant="contained" disabled={isSubmitting} fullWidth sx={{ minHeight: 44.5 }}>
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </ActionBar>
            </Stack>
          </Box>
        </Stack>
      </PageShell>
    </AnimatedRoute>
  );
}
