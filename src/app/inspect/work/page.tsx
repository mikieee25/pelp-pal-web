import { Suspense } from 'react';
import { OfflineInspection } from './offline-inspection';

export default function OfflineInspectionPage() {
  return <Suspense fallback={<main className="mx-auto max-w-3xl px-4 py-6" role="status">Opening inspection…</main>}><OfflineInspection /></Suspense>;
}
