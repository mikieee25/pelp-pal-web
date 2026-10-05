'use client';

import { useEffect, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { getBrowserRepository } from '@/lib/db/browser';

export function DeviceEnrollmentStatus({ surface = true }: { surface?: boolean }) {
  const [status, setStatus] = useState<'checking' | 'enrolled' | 'not-enrolled' | 'error'>('checking');

  useEffect(() => {
    let active = true;
    void getBrowserRepository().getDevice()
      .then((device) => {
        if (active) setStatus(device?.enrolled ? 'enrolled' : 'not-enrolled');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => { active = false; };
  }, []);

  const message = status === 'checking'
    ? 'Checking browser enrollment…'
    : status === 'enrolled'
      ? 'This browser is enrolled and ready to sync.'
      : status === 'error'
        ? 'We could not read this browser’s enrollment status.'
        : 'Offline until this browser is enrolled.';

  const content = (
    <Typography color={status === 'enrolled' ? 'success.main' : status === 'error' ? 'error.main' : 'warning.main'}>
      {message}
    </Typography>
  );

  return surface ? <Paper role="status" sx={{ p: 3 }}>{content}</Paper> : <Box role="status">{content}</Box>;
}
