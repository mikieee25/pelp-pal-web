import { Container, Paper, Stack, Typography } from '@mui/material';

export default function HomePage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
      <Paper component="main" elevation={0} sx={{ p: { xs: 3, md: 5 } }}>
        <Stack spacing={2}>
          <Typography component="h1" variant="h3">
            PELP Pal
          </Typography>
          <Typography color="text.secondary">
            Offline-first inspection workspace for authorized PELP Pal devices.
          </Typography>
        </Stack>
      </Paper>
    </Container>
  );
}
