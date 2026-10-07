import { Container } from '@mui/material';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { InspectionEditor } from '@/features/inspection/inspection-editor';
import { InspectionGuard } from '@/features/store/inspection-guard';
import { WorkspaceAuthGate } from '@/features/auth/workspace-auth-gate';

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ inspectionId: string }>; searchParams: Promise<{ catalogId?: string; view?: string }> }) {
  const { inspectionId } = await params;
  const { catalogId, view } = await searchParams;
  return <WorkspaceAuthGate><AnimatedRoute><Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}><InspectionGuard inspectionId={inspectionId}><InspectionEditor inspectionId={inspectionId} catalogId={catalogId} readOnly={view === '1' || view === 'true'} /></InspectionGuard></Container></AnimatedRoute></WorkspaceAuthGate>;
}
