import { beforeEach, describe, expect, it } from 'vitest';
import { clearLocalSession, getLocalSession, saveLocalSession } from '@/lib/auth/local-session-store';

beforeEach(() => localStorage.clear());

describe('local session store', () => {
  it('persists only the normalized username', () => {
    saveLocalSession(' EPRED-1 ');
    expect(getLocalSession()).toEqual({ username: 'epred-1' });
    expect(localStorage.getItem('pelp-pal-local-session')).not.toContain('password');
  });

  it('clears the session', () => {
    saveLocalSession('epred-1');
    clearLocalSession();
    expect(getLocalSession()).toBeNull();
  });
});
