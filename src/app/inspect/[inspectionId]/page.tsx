import { Container } from '@mui/material';
import { InspectionEditor } from '@/features/inspection/inspection-editor';

export default async function InspectionPage({ params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  return <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}><InspectionEditor inspectionId={inspectionId} /></Container>;
}
