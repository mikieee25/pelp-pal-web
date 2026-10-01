import { Container, Paper, Stack, Typography } from '@mui/material';

export default function AccountPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Account</Typography>
        <Typography color="text.secondary">Enrollment and local account status for this browser.</Typography>
      </Stack>
      <Paper sx={{ p: 3 }}><Typography color="text.secondary">This browser is not enrolled.</Typography></Paper>
    </Container>
  );
}
