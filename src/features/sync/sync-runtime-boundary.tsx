'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { startSyncRuntime, type SyncRuntime } from '@/lib/sync/runtime';
import type { SyncStatusStore } from './sync-status-store';

type SyncRuntimeState = {
  statusStore?: SyncStatusStore;
  error?: string;
  starting: boolean;
};

const SyncRuntimeStateContext = createContext<SyncRuntimeState>({ starting: true });

export function useSyncRuntimeState(): SyncRuntimeState {
  return useContext(SyncRuntimeStateContext);
}

export function useSyncRuntimeStatusStore(): SyncStatusStore | undefined {
  return useSyncRuntimeState().statusStore;
}

export function SyncRuntimeBoundary({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<SyncRuntime>();
  const [runtimeError, setRuntimeError] = useState<string>();
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let active = true;
    let mountedRuntime: SyncRuntime | undefined;

    void startSyncRuntime()
      .then((nextRuntime) => {
        if (!active) {
          nextRuntime?.stop();
          return;
        }
        mountedRuntime = nextRuntime;
        setRuntime(nextRuntime);
        setStarting(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeError(error instanceof Error ? error.message : 'Synchronization could not start.');
        setStarting(false);
      });

    return () => {
      active = false;
      mountedRuntime?.stop();
      setRuntime(undefined);
    };
  }, []);

  return (
    <SyncRuntimeStateContext.Provider value={{ statusStore: runtime?.statusStore, error: runtimeError, starting }}>
      {children}
    </SyncRuntimeStateContext.Provider>
  );
}
