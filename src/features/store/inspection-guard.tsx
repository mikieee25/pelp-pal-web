'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { CircularProgress, Stack, Typography } from '@mui/material';
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
    return <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}><CircularProgress aria-label="Checking active store" /><Typography color="text.secondary">Checking the active store…</Typography></Stack>;
  }
  return <>{children}</>;
}
