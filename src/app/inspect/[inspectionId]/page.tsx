import { redirect } from 'next/navigation';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { InspectionEditor } from '@/features/inspection/inspection-editor';
import { InspectionGuard } from '@/features/store/inspection-guard';
import { WorkspaceAuthGate } from '@/features/auth/workspace-auth-gate';

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ inspectionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { inspectionId } = await params;
  const query = await searchParams;
  if (inspectionId === 'new') {
    const queryString = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => queryString.append(key, item));
      else if (value !== undefined) queryString.set(key, value);
    }
    const suffix = queryString.size ? `?${queryString}` : '';
    redirect(`/inspect/${crypto.randomUUID()}${suffix}`);
  }
  const catalogId = Array.isArray(query.catalogId) ? query.catalogId[0] : query.catalogId;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  return <WorkspaceAuthGate><AnimatedRoute><div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 md:py-10"><InspectionGuard inspectionId={inspectionId}><InspectionEditor inspectionId={inspectionId} catalogId={catalogId} readOnly={view === '1' || view === 'true'} /></InspectionGuard></div></AnimatedRoute></WorkspaceAuthGate>;
}
