import { describe, expect, it } from 'vitest';
import { authenticateLocalAccount } from '@/lib/auth/local-session';

const passwordHash = '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$-F2NoNJvnM2HQ9iXx5w_BIuiK0QtmgyVJypaTF3Gty4';

describe('local account authentication', () => {
  it('authenticates an active account with the Flutter-compatible hash', async () => {
    await expect(authenticateLocalAccount({ username: 'EPRED-1', passwordHash, isActive: true }, 'epred-1', 'demo-password')).resolves.toEqual({
      ok: true,
      username: 'epred-1',
    });
  });

  it('locks inactive accounts before checking the password', async () => {
    await expect(authenticateLocalAccount({ username: 'epred-1', passwordHash, isActive: false }, 'epred-1', 'demo-password')).resolves.toEqual({
      ok: false,
      reason: 'inactive',
    });
  });
});
