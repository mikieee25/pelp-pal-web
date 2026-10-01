'use client';

import { useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { authenticateLocalAccount } from '@/lib/auth/local-session';
import { saveLocalSession } from '@/lib/auth/local-session-store';
import { getBrowserRepository } from '@/lib/db/browser';

export default function LoginPage() {
  const [message, setMessage] = useState<string>();
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper component="form" sx={{ p: { xs: 3, md: 5 } }} onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const username = String(form.get('username') ?? '');
        const password = String(form.get('password') ?? '');
        const account = await getBrowserRepository().getAccountByUsername(username);
        if (!account || typeof account.passwordHash !== 'string' || typeof account.isActive !== 'boolean') {
          setMessage('No synchronized active account was found on this browser.');
          return;
        }
        const result = await authenticateLocalAccount(account as unknown as { username: string; passwordHash: string; isActive: boolean }, username, password);
        if (!result.ok) {
          setMessage(result.reason === 'inactive' ? 'This account is inactive.' : 'Invalid credentials.');
          return;
        }
        saveLocalSession(result.username);
        setMessage('Signed in locally.');
      }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">Local login</Typography>
          <Typography color="text.secondary">Use the account synchronized to this enrolled browser.</Typography>
          <TextField required name="username" label="Username" autoComplete="username" />
          <TextField required name="password" label="Password" type="password" autoComplete="current-password" />
          {message && <Alert severity="info">{message}</Alert>}
          <Button type="submit" variant="contained">Sign in</Button>
        </Stack>
      </Paper>
    </Container>
  );
}
