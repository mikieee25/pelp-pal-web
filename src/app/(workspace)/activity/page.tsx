import { Container, Paper, Stack, Typography } from '@mui/material';

export default function ActivityPage() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Activity</Typography>
        <Typography color="text.secondary">Events synchronized for this authorized device.</Typography>
      </Stack>
      <Paper sx={{ p: 3 }}><Typography color="text.secondary">No activity has been synchronized yet.</Typography></Paper>
    </Container>
  );
}
