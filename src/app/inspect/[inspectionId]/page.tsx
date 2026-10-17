import { AnimatedRoute } from '@/components/motion/animated-route';
import { InspectionEditor } from '@/features/inspection/inspection-editor';
import { InspectionGuard } from '@/features/store/inspection-guard';
import { WorkspaceAuthGate } from '@/features/auth/workspace-auth-gate';

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ inspectionId: string }>; searchParams: Promise<{ catalogId?: string; view?: string }> }) {
  const { inspectionId } = await params;
  const { catalogId, view } = await searchParams;
  return <WorkspaceAuthGate><AnimatedRoute><div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 md:py-10"><InspectionGuard inspectionId={inspectionId}><InspectionEditor inspectionId={inspectionId} catalogId={catalogId} readOnly={view === '1' || view === 'true'} /></InspectionGuard></div></AnimatedRoute></WorkspaceAuthGate>;
}
