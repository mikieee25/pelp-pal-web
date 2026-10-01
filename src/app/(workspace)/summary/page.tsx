import { Container, Paper, Stack, Typography } from '@mui/material';

export default function SummaryPage() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Summary</Typography>
        <Typography color="text.secondary">Compliance summary from the synchronized local mirror.</Typography>
      </Stack>
      <Paper sx={{ p: 3 }}><Typography color="text.secondary">Complete an inspection to populate this summary.</Typography></Paper>
    </Container>
  );
}
