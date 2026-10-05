import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { SyncRuntimeBoundary } from '@/features/sync/sync-runtime-boundary';

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell><SyncRuntimeBoundary />{children}</AppShell>;
}
