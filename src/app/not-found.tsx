import { Stack, Typography } from '@mui/material';

export default function NotFound() {
  return (
    <Stack alignItems="center" spacing={1} sx={{ p: 4 }}>
      <Typography component="h1" variant="h4">Page not found</Typography>
      <Typography color="text.secondary">The requested workspace page does not exist.</Typography>
    </Stack>
  );
}
