import { Container } from '@mui/material';
import { StoreForm } from '@/features/store/store-form';

export default function StorePage() {
  return <Container maxWidth="md" sx={{ px: { xs: 2, sm: 3, md: 4 }, py: { xs: 3, md: 5 } }}><StoreForm /></Container>;
}
