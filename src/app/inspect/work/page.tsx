import { Suspense } from "react";
import { OfflineInspection } from "./offline-inspection";

export default function OfflineInspectionPage() {
  return (
    <Suspense
      fallback={
        <main
          className="flex min-h-[50vh] items-center justify-center px-4 py-12"
          role="status"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-white px-6 py-4 shadow-sm">
            <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm font-medium text-ink">
              Opening inspection…
            </span>
          </div>
        </main>
      }
    >
      <OfflineInspection />
    </Suspense>
  );
}
