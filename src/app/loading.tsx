import { CircularProgress, Stack } from '@mui/material';

export default function Loading() {
  return (
    <Stack alignItems="center" justifyContent="center" minHeight="40vh">
      <CircularProgress aria-label="Loading" />
    </Stack>
  );
}
