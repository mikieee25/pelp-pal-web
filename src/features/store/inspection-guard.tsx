'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getBrowserRepository } from '@/lib/db/browser';

export function InspectionGuard({ inspectionId, children }: { inspectionId: string; children: ReactNode }) {
  const repository = useMemo(() => getBrowserRepository(), []);
  const router = useRouter();
  const pathname = usePathname() ?? `/inspect/${inspectionId}`;
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getCurrentStore(), repository.getInspection(inspectionId)]).then(([store, inspection]) => {
      if (!active) return;
      if (store || inspection?.status === 'completed') {
        setAllowed(true);
      } else {
        router.replace(`/store?returnTo=${encodeURIComponent(pathname)}`);
      }
    });
    return () => { active = false; };
  }, [inspectionId, pathname, repository, router]);

  if (!allowed) {
    return <div className="flex flex-col items-center gap-3 py-16 text-center"><span role="progressbar" aria-label="Checking active store" className="size-8 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" /><p className="text-sm text-muted">Checking the active store…</p></div>;
  }
  return <>{children}</>;
}
