'use client';

import { useEffect } from 'react';
import { startSyncRuntime } from '@/lib/sync/runtime';

export function SyncRuntimeBoundary() {
  useEffect(() => {
    void startSyncRuntime().catch(() => undefined);
    return undefined;
  }, []);

  return null;
}
