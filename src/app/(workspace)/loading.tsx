import { Container, Paper, Skeleton, Stack } from '@mui/material';

export default function WorkspaceLoading() {
  return (
    <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}>
      <Stack role="status" aria-label="Loading workspace" spacing={2.5}>
        <Stack spacing={1}>
          <Skeleton variant="text" width={120} height={24} />
          <Skeleton variant="text" width="min(420px, 80%)" height={52} />
          <Skeleton variant="text" width="min(560px, 92%)" height={28} />
        </Stack>
        <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, border: 1, borderColor: 'divider', borderRadius: 3 }}>
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={72} />
            <Skeleton variant="rounded" height={148} />
            <Skeleton variant="rounded" height={148} />
          </Stack>
        </Paper>
      </Stack>
    </Container>
  );
}
