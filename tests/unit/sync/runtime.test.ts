import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBrowserRepository: vi.fn(),
  getSupabaseBrowserClient: vi.fn(),
  getCurrentAccount: vi.fn(),
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
vi.mock('@/lib/supabase/browser', () => ({ getSupabaseBrowserClient: mocks.getSupabaseBrowserClient }));
vi.mock('@/features/auth/account-password', () => ({ getCurrentAccount: mocks.getCurrentAccount }));
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
    mocks.getSupabaseBrowserClient.mockReset();
    mocks.getCurrentAccount.mockReset();
  });

  it('does not create a remote runtime without an authenticated account', async () => {
    mocks.getBrowserRepository.mockReturnValue({ setAccountScope: vi.fn() });
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) } });

    await expect(startSyncRuntime()).resolves.toBeUndefined();
    expect(getSyncRuntime()).toBeUndefined();
    expect(mocks.getCurrentAccount).not.toHaveBeenCalled();
  });

  it('creates one account-scoped runtime and one realtime subscription per browser session', async () => {
    const setAccountScope = vi.fn();
    const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null }) } };
    mocks.getBrowserRepository.mockReturnValue({ setAccountScope });
    mocks.getSupabaseBrowserClient.mockReturnValue(client);
    mocks.getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', role: 'epred', isActive: true });

    const first = await startSyncRuntime();
    const second = await startSyncRuntime();

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(mocks.getSupabaseBrowserClient).toHaveBeenCalledTimes(1);
    expect(setAccountScope).toHaveBeenCalledWith({ accountId: 'account-1', organizationId: 'org-1', key: 'org-1:account-1' });
    expect(mocks.coordinatorInstances).toHaveLength(1);
    expect(mocks.realtimeStart).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatorInstances[0]?.syncNow).toHaveBeenCalledWith('startup');
  });

  it('polls visible online browsers and stops polling with the runtime', async () => {
    vi.useFakeTimers();
    mocks.getBrowserRepository.mockReturnValue({ setAccountScope: vi.fn() });
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null }) } });
    mocks.getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', role: 'admin', isActive: true });

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
    mocks.getBrowserRepository.mockReturnValue({ setAccountScope: vi.fn() });
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null }) } });
    mocks.getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', role: 'admin', isActive: true });

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

  it('rejects an inactive personnel account before starting sync', async () => {
    mocks.getBrowserRepository.mockReturnValue({ setAccountScope: vi.fn() });
    mocks.getSupabaseBrowserClient.mockReturnValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null }) } });
    mocks.getCurrentAccount.mockResolvedValue({ id: 'account-1', organizationId: 'org-1', role: 'admin', isActive: false });

    await expect(startSyncRuntime()).rejects.toThrow(/inactive/i);
    expect(mocks.coordinatorInstances).toHaveLength(0);
  });
});
