'use client';

import { useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { buildEnrollmentRequest } from '@/features/enrollment/enrollment-service';
import { enrollBrowserDevice } from '@/features/enrollment/enrollment-client';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { APP_VERSION } from '@/lib/config/app-version';

export default function EnrollPage() {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper component="form" sx={{ p: { xs: 3, md: 5 } }} onSubmit={async (event) => {
        event.preventDefault();
        try {
          const repository = getBrowserRepository();
          const installationId = await repository.getOrCreateInstallationId();
          const request = buildEnrollmentRequest(code, installationId, APP_VERSION);
          const result = await enrollBrowserDevice(getSupabaseBrowserClient(), repository, request);
          setMessage(`Enrolled as ${result.assigned_username}.`);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Enrollment could not start.');
        }
      }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">Enroll this browser</Typography>
          <Typography color="text.secondary">Use the enrollment code issued for this device.</Typography>
          <TextField required label="Enrollment code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
          {message && <Alert severity="info">{message}</Alert>}
          <Button type="submit" variant="contained">Continue</Button>
        </Stack>
      </Paper>
    </Container>
  );
}
