import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBrowserRepository: vi.fn(),
  getSupabaseDeviceClient: vi.fn(),
  ensureAnonymousSession: vi.fn(),
  getLocalSession: vi.fn(),
  realtimeStart: vi.fn(() => vi.fn()),
  realtimeSubscribe: vi.fn(() => () => undefined),
  realtimeGetSnapshot: vi.fn(() => ({ state: 'disconnected' as const })),
  coordinatorInstances: [] as Array<{
    syncNow: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    getSnapshot: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@/lib/db/browser', () => ({ getBrowserRepository: mocks.getBrowserRepository }));
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseDeviceClient: mocks.getSupabaseDeviceClient }));
vi.mock('@/lib/auth/session-bootstrap', () => ({ ensureAnonymousSession: mocks.ensureAnonymousSession }));
vi.mock('@/lib/auth/local-session-store', () => ({ getLocalSession: mocks.getLocalSession }));
vi.mock('@/lib/supabase/remote-source', () => ({ SupabaseSyncRemote: class {} }));
vi.mock('@/lib/realtime/coordinator', () => ({
  RealtimeCoordinator: class {
    start = mocks.realtimeStart;
    subscribe = mocks.realtimeSubscribe;
    getSnapshot = mocks.realtimeGetSnapshot;
  },
}));
vi.mock('@/lib/sync/coordinator', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sync/coordinator')>('@/lib/sync/coordinator');
  return {
    ...actual,
    SyncCoordinator: class {
      private readonly snapshot = { status: 'offline', pendingCount: 0, conflictCount: 0 } as const;
      syncNow = vi.fn().mockResolvedValue(undefined);
      subscribe = vi.fn(() => () => undefined);
      getSnapshot = vi.fn(() => this.snapshot);

      constructor() {
        mocks.coordinatorInstances.push(this);
      }
    },
  };
});

import { getSyncRuntime, startSyncRuntime } from '@/lib/sync/runtime';

describe('shared sync runtime', () => {
  afterEach(() => {
    getSyncRuntime()?.stop();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.coordinatorInstances.length = 0;
    mocks.getLocalSession.mockReturnValue(null);
  });

  it('does not create a runtime before the browser is enrolled', async () => {
    mocks.getBrowserRepository.mockReturnValue({ getDevice: vi.fn().mockResolvedValue({ enrolled: false }) });

    await expect(startSyncRuntime()).resolves.toBeUndefined();
    expect(getSyncRuntime()).toBeUndefined();
    expect(mocks.getSupabaseDeviceClient).not.toHaveBeenCalled();
  });

  it('creates one runtime and one realtime subscription per browser session', async () => {
    mocks.getBrowserRepository.mockReturnValue({ getDevice: vi.fn().mockResolvedValue({ enrolled: true }) });
    mocks.getSupabaseDeviceClient.mockReturnValue({});
    mocks.ensureAnonymousSession.mockResolvedValue({ user: { id: 'device-1', is_anonymous: true } });

    const first = await startSyncRuntime();
    const second = await startSyncRuntime();

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(mocks.getSupabaseDeviceClient).toHaveBeenCalledTimes(1);
    expect(mocks.ensureAnonymousSession).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatorInstances).toHaveLength(1);
    expect(mocks.realtimeStart).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatorInstances[0]?.syncNow).toHaveBeenCalledWith('startup');
  });

  it('polls visible online browsers and stops polling with the runtime', async () => {
    vi.useFakeTimers();
    mocks.getBrowserRepository.mockReturnValue({ getDevice: vi.fn().mockResolvedValue({ enrolled: true }) });
    mocks.getSupabaseDeviceClient.mockReturnValue({});
    mocks.ensureAnonymousSession.mockResolvedValue({ user: { id: 'device-1', is_anonymous: true } });

    await startSyncRuntime();
    const coordinator = mocks.coordinatorInstances[0];
    coordinator?.syncNow.mockClear();

    await vi.advanceTimersByTimeAsync(45_000);
    expect(coordinator?.syncNow).toHaveBeenCalledWith('resume');

    coordinator?.syncNow.mockClear();
    getSyncRuntime()?.stop();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(coordinator?.syncNow).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not poll while hidden or offline', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    mocks.getBrowserRepository.mockReturnValue({ getDevice: vi.fn().mockResolvedValue({ enrolled: true }) });
    mocks.getSupabaseDeviceClient.mockReturnValue({});
    mocks.ensureAnonymousSession.mockResolvedValue({ user: { id: 'device-1', is_anonymous: true } });

    await startSyncRuntime();
    const coordinator = mocks.coordinatorInstances[0];
    coordinator?.syncNow.mockClear();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(coordinator?.syncNow).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    online.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(coordinator?.syncNow).not.toHaveBeenCalled();
  });

  it('refuses to sync an enrolled device under the wrong account', async () => {
    mocks.getBrowserRepository.mockReturnValue({
      getDevice: vi.fn().mockResolvedValue({ enrolled: true, assignedUsername: 'epred.one' }),
    });
    mocks.getSupabaseDeviceClient.mockReturnValue({});
    mocks.ensureAnonymousSession.mockResolvedValue({ user: { id: 'device-1', is_anonymous: true } });
    mocks.getLocalSession.mockReturnValue({ username: 'epred.two' });

    await expect(startSyncRuntime()).rejects.toThrow(/enrolled for epred\.one/i);
    expect(mocks.coordinatorInstances).toHaveLength(0);
  });
});
