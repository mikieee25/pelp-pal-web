'use client';

import { useSearchParams } from 'next/navigation';
import { AnimatedRoute } from '@/components/motion/animated-route';
import { InspectionEditor } from '@/features/inspection/inspection-editor';
import { InspectionGuard } from '@/features/store/inspection-guard';
import { WorkspaceAuthGate } from '@/features/auth/workspace-auth-gate';
import { SyncRuntimeBoundary } from '@/features/sync/sync-runtime-boundary';
import { AppShell } from '@/components/app-shell/app-shell';

export function OfflineInspection() {
  const params = useSearchParams();
  const inspectionId = params.get('inspectionId');
  if (!inspectionId || !/^[0-9a-f-]{36}$/i.test(inspectionId)) {
    return <main className="mx-auto max-w-3xl px-4 py-6" role="alert">This inspection link is invalid.</main>;
  }
  const view = params.get('view');
  return <WorkspaceAuthGate><SyncRuntimeBoundary><AppShell><AnimatedRoute><main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 md:py-10"><InspectionGuard inspectionId={inspectionId}><InspectionEditor inspectionId={inspectionId} catalogId={params.get('catalogId') ?? undefined} readOnly={view === '1' || view === 'true'} /></InspectionGuard></main></AnimatedRoute></AppShell></SyncRuntimeBoundary></WorkspaceAuthGate>;
}
