import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeCoordinator } from '@/lib/realtime/coordinator';

type StatusCallback = (status: string, error?: unknown) => void;

function createClient() {
  const channels: Array<{ emit: StatusCallback }> = [];
  const client = {
    channel: vi.fn(() => {
      const channel = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((callback: StatusCallback) => {
          channels.push({ emit: callback });
          return channel;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  };
  return { client, channels };
}

describe('RealtimeCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['CHANNEL_ERROR', 'CLOSED'])('re-subscribes after %s with backoff', async (status) => {
    vi.useFakeTimers();
    const { client, channels } = createClient();
    const sync = { syncNow: vi.fn().mockResolvedValue(undefined) };
    const stop = new RealtimeCoordinator(client as never, sync as never).start();

    channels[0]?.emit(status, new Error('realtime disconnected'));
    expect(sync.syncNow).toHaveBeenCalledWith('retry');
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(client.channel).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(client.channel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.channel).toHaveBeenCalledTimes(2);

    stop();
  });

  it('cancels a pending reconnect and removes the current channel on cleanup', async () => {
    vi.useFakeTimers();
    const { client, channels } = createClient();
    const stop = new RealtimeCoordinator(client as never, { syncNow: vi.fn().mockResolvedValue(undefined) } as never).start();

    channels[0]?.emit('TIMED_OUT');
    stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(client.channel).toHaveBeenCalledTimes(1);
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
  });
});
