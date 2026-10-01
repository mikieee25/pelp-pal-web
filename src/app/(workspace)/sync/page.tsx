import { Container, Paper, Stack, Typography } from '@mui/material';

export default function SyncPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Sync</Typography>
        <Typography color="text.secondary">The synchronization coordinator will show live state here.</Typography>
      </Stack>
      <Paper sx={{ p: 3 }}><Typography color="warning.main">Offline until this browser is enrolled.</Typography></Paper>
    </Container>
  );
}
