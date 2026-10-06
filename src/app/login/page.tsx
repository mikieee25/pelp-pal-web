'use client';

import { useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { sanitizeNextPath } from '@/features/auth/workspace-auth-gate';
import { signInWithCredentials } from '@/lib/auth/local-session';
import { saveLocalSession } from '@/lib/auth/local-session-store';
import { PasswordField } from '@/components/forms/password-field';
import { AnimatedRoute } from '@/components/motion/animated-route';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <AnimatedRoute>
      <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper component="form" sx={{ p: { xs: 3, md: 5 } }} onSubmit={async (event) => {
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
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">Sign in</Typography>
          <Typography color="text.secondary">Use your PELP Pal username and password. Device enrollment is not required.</Typography>
          <TextField required name="username" label="Username" autoComplete="username" />
          <PasswordField required name="password" label="Password" autoComplete="current-password" />
          {message && <Alert severity="info">{message}</Alert>}
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </Paper>
      </Container>
    </AnimatedRoute>
  );
}
