import { redirect } from "next/navigation";
import { AnimatedRoute } from "@/components/motion/animated-route";
import { InspectionEditor } from "@/features/inspection/inspection-editor";
import { InspectionGuard } from "@/features/store/inspection-guard";
import { WorkspaceAuthGate } from "@/features/auth/workspace-auth-gate";
import { SyncRuntimeBoundary } from "@/features/sync/sync-runtime-boundary";

export default async function InspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ inspectionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { inspectionId } = await params;
  const query = await searchParams;
  if (inspectionId === "new") {
    const queryString = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value))
        value.forEach((item) => queryString.append(key, item));
      else if (value !== undefined) queryString.set(key, value);
    }
    const suffix = queryString.size ? `?${queryString}` : "";
    redirect(`/inspect/${crypto.randomUUID()}${suffix}`);
  }
  const catalogId = Array.isArray(query.catalogId)
    ? query.catalogId[0]
    : query.catalogId;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const notRegistered = Array.isArray(query.notRegistered)
    ? query.notRegistered[0]
    : query.notRegistered;
  return (
    <WorkspaceAuthGate>
      <SyncRuntimeBoundary>
        <AnimatedRoute>
          <main className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6 sm:py-8 md:py-10">
            <InspectionGuard inspectionId={inspectionId}>
              <InspectionEditor
                inspectionId={inspectionId}
                catalogId={catalogId}
                notRegistered={notRegistered === "1"}
                readOnly={view === "1" || view === "true"}
              />
            </InspectionGuard>
          </main>
        </AnimatedRoute>
      </SyncRuntimeBoundary>
    </WorkspaceAuthGate>
  );
}
