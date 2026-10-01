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
});
