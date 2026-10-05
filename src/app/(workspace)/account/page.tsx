import { Container, Stack, Typography } from '@mui/material';
import { DeviceEnrollmentStatus } from '@/components/device/device-enrollment-status';

export default function AccountPage() {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={1} sx={{ mb: 3 }}>
        <Typography component="h1" variant="h4">Account</Typography>
        <Typography color="text.secondary">Enrollment and local account status for this browser.</Typography>
      </Stack>
      <DeviceEnrollmentStatus />
    </Container>
  );
}
