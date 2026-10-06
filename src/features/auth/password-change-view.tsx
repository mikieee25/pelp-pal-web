'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { useRouter, useSearchParams } from 'next/navigation';
import { sanitizeNextPath } from './workspace-auth-gate';
import { changeCurrentAccountPassword, getCurrentAccount, type CurrentAccount } from './account-password';

export function PasswordChangeView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<CurrentAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentAccount()
      .then((current) => {
        if (active) setAccount(current);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the signed-in account.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 6 || newPassword.length > 128) {
      setError('Choose a password between 6 and 128 characters.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    if (!account) {
      setError('The signed-in account is unavailable.');
      return;
    }

    setSaving(true);
    try {
      await changeCurrentAccountPassword(account.id, newPassword);
      router.replace(sanitizeNextPath(searchParams.get('next')));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change the password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, md: 7 } }}>
      <Paper component="form" onSubmit={(event) => void submit(event)} sx={{ p: { xs: 3, md: 5 } }}>
        <Stack spacing={2}>
          <Typography variant="overline" color="primary.main" fontWeight={800}>ACCOUNT SECURITY</Typography>
          <Typography component="h1" variant="h4">Change your password</Typography>
          <Typography color="text.secondary">
            {loading
              ? 'Checking your account…'
              : `Hello ${account?.displayName ?? account?.username ?? ''}. Your default or temporary password must be changed before you continue.`}
          </Typography>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <TextField
            required
            autoFocus
            name="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            helperText="Use 6–128 characters."
            disabled={loading || saving}
          />
          <TextField
            required
            name="confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={loading || saving}
          />
          <Button type="submit" variant="contained" disabled={loading || saving || !account}>
            {saving ? 'Updating password…' : 'Continue'}
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
