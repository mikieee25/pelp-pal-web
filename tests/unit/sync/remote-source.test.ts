import { describe, expect, it } from 'vitest';
import { parsePullPage } from '@/lib/supabase/remote-source';

describe('parsePullPage', () => {
  it('accepts all cursor collections', () => {
    expect(parsePullPage({ revisions: [], activities: [], conflicts: [], deletions: [] })).toEqual({
      revisions: [], activities: [], conflicts: [], deletions: [],
    });
  });

  it('rejects a missing collection instead of silently treating it as empty', () => {
    expect(() => parsePullPage({ revisions: [] })).toThrow('activities');
  });

  it('rejects rows with a non-positive or non-integer cursor', () => {
    expect(() => parsePullPage({
      revisions: [{ id: 'revision-1', change_cursor: 0 }],
      activities: [],
      conflicts: [],
      deletions: [],
    })).toThrow(/change_cursor/i);
  });
});
