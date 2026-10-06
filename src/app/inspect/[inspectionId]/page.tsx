import { Container } from '@mui/material';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { InspectionEditor } from '@/features/inspection/inspection-editor';
import { InspectionGuard } from '@/features/store/inspection-guard';

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ inspectionId: string }>; searchParams: Promise<{ catalogId?: string }> }) {
  const { inspectionId } = await params;
  const { catalogId } = await searchParams;
  return <AnimatedRoute><Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}><InspectionGuard inspectionId={inspectionId}><InspectionEditor inspectionId={inspectionId} catalogId={catalogId} /></InspectionGuard></Container></AnimatedRoute>;
}
