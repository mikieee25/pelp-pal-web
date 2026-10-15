import { describe, expect, it } from 'vitest';
import { getSyncErrorPresentation, getSyncHeadline } from '@/features/sync/sync-presentation';
import type { SyncStatusSnapshot } from '@/features/sync/sync-status-store';

function snapshot(overrides: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  return { status: 'live', pendingCount: 0, conflictCount: 0, ...overrides };
}

describe('sync presentation', () => {
  it.each([
    [snapshot(), 'Everything is up to date', 'success'],
    [snapshot({ pendingCount: 2, retryingCount: 1, evidencePendingCount: 2 }), '5 waiting to upload', 'warning'],
    [snapshot({ status: 'syncing', operation: 'upload' }), 'Syncing…', 'info'],
    [snapshot({ failedCount: 1 }), 'Needs attention', 'error'],
    [snapshot({ conflictCount: 1 }), 'Needs attention', 'error'],
  ] as const)('maps snapshot to headline %s', (state, title, tone) => {
    expect(getSyncHeadline(state)).toMatchObject({ title, tone });
  });

  it('deduplicates raw error details while mapping friendly messages', () => {
    expect(getSyncErrorPresentation(snapshot({ lastError: 'Object not found', lastOperationResult: {
      operation: 'full', completedAt: '', uploadedCount: 0, downloadedCount: 0,
      unchangedCount: 0, retryingCount: 0, conflictedCount: 0, failedCount: 1, error: 'Object not found',
    } }))).toEqual({
      message: 'A photo couldn\'t be found on the server yet. It will be uploaded again from the device that took it.',
      details: ['Object not found'],
      kind: 'retry',
    });
  });

  it.each([
    ['offline', 'You\'re offline. Changes will upload when you\'re back online.'],
    ['Unexpected RPC failure', 'Sync couldn\'t finish. Try again.'],
  ])('maps %s to plain-language feedback', (message, expected) => {
    expect(getSyncErrorPresentation(snapshot({ lastError: message }))?.message).toBe(expected);
  });
});
