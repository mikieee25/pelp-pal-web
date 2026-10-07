import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSyncRuntime: vi.fn(),
  stop: vi.fn(),
  store: { subscribe: vi.fn(), getSnapshot: vi.fn(), syncNow: vi.fn() },
}));

vi.mock('@/lib/sync/runtime', () => ({
  startSyncRuntime: mocks.startSyncRuntime,
}));

import { SyncRuntimeBoundary, useSyncRuntimeStatusStore } from '@/features/sync/sync-runtime-boundary';

function Consumer() {
  return <div>{useSyncRuntimeStatusStore() ? 'store ready' : 'store pending'}</div>;
}

describe('SyncRuntimeBoundary', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the runtime store when startup finishes and stops it on unmount', async () => {
    let resolveRuntime: (runtime: unknown) => void = () => undefined;
    mocks.startSyncRuntime.mockReturnValue(new Promise((resolve) => { resolveRuntime = resolve; }));

    const view = render(<SyncRuntimeBoundary><Consumer /></SyncRuntimeBoundary>);
    expect(screen.getByText('store pending')).toBeTruthy();

    await act(async () => {
      resolveRuntime({ statusStore: mocks.store, stop: mocks.stop });
    });

    expect(screen.getByText('store ready')).toBeTruthy();
    view.unmount();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
});
