import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell/app-shell';
import { WorkspaceAuthGate } from '@/features/auth/workspace-auth-gate';
import { SyncRuntimeBoundary } from '@/features/sync/sync-runtime-boundary';

export default function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <WorkspaceAuthGate><AppShell><SyncRuntimeBoundary />{children}</AppShell></WorkspaceAuthGate>;
}
