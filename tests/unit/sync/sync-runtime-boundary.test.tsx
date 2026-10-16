import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { startSyncRuntime, runtime } = vi.hoisted(() => ({
  startSyncRuntime: vi.fn(),
  runtime: { coordinator: {}, statusStore: {}, stop: vi.fn() },
}));

vi.mock('@/lib/sync/runtime', () => ({ startSyncRuntime: (...args: unknown[]) => startSyncRuntime(...args) }));

import { SyncRuntimeBoundary, useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';

function Consumer() {
  return <div>{useSyncRuntimeStatusStore() ? 'store ready' : 'store pending'}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SyncRuntimeBoundary', () => {
  it('publishes the runtime store when startup finishes and stops it on unmount', async () => {
    let resolveRuntime: (value: typeof runtime) => void = () => undefined;
    startSyncRuntime.mockReturnValue(new Promise((resolve) => { resolveRuntime = resolve; }));

    const view = render(<SyncRuntimeBoundary><Consumer /></SyncRuntimeBoundary>);
    expect(screen.getByText('store pending')).toBeInTheDocument();
    await act(async () => { resolveRuntime(runtime); });
    expect(screen.getByText('store ready')).toBeInTheDocument();
    view.unmount();
    expect(runtime.stop).toHaveBeenCalledTimes(1);
  });

  it('does not stop the shared runtime when Strict Mode remounts the boundary', async () => {
    startSyncRuntime.mockResolvedValue(runtime);

    render(<StrictMode><SyncRuntimeBoundary><div>Workspace ready</div></SyncRuntimeBoundary></StrictMode>);

    await waitFor(() => expect(screen.getByText('Workspace ready')).toBeInTheDocument());
    expect(startSyncRuntime).toHaveBeenCalled();
    expect(runtime.stop).not.toHaveBeenCalled();
  });
});
