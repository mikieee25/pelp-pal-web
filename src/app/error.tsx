'use client';

import { Button, Stack, Typography } from '@mui/material';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Stack alignItems="center" spacing={2} sx={{ p: 4 }}>
      <Typography component="h1" variant="h4">Something went wrong</Typography>
      <Typography color="text.secondary">Your local work was not cleared.</Typography>
      <Button variant="contained" onClick={reset}>Try again</Button>
    </Stack>
  );
}
