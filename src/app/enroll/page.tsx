'use client';

import { useRef, useState } from 'react';
import { Alert, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { buildEnrollmentRequest } from '@/features/enrollment/enrollment-service';
import { DeviceAlreadyEnrolledError, enrollBrowserDevice } from '@/features/enrollment/enrollment-client';
import { getBrowserRepository } from '@/lib/db/browser';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { APP_VERSION } from '@/lib/config/app-version';

export default function EnrollPage() {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper component="form" sx={{ p: { xs: 3, md: 5 } }} onSubmit={async (event) => {
        event.preventDefault();
        if (isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        try {
          const repository = getBrowserRepository();
          const installationId = await repository.getOrCreateInstallationId();
          const request = buildEnrollmentRequest(code, installationId, APP_VERSION);
          await enrollBrowserDevice(getSupabaseBrowserClient(), repository, request);
          router.replace('/login');
        } catch (error) {
          if (error instanceof DeviceAlreadyEnrolledError) {
            setMessage('Browser is already enrolled. Redirecting you to sign in…');
            window.setTimeout(() => router.replace('/login'), 800);
            return;
          }
          setMessage(error instanceof Error ? error.message : 'Enrollment could not start.');
        } finally {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        }
      }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h4">Enroll this browser</Typography>
          <Typography color="text.secondary">Use the enrollment code issued for this device.</Typography>
          <TextField required label="Enrollment code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
          {message && <Alert severity="info">{message}</Alert>}
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Enrolling…' : 'Continue'}
          </Button>
        </Stack>
      </Paper>
    </Container>
  );
}
