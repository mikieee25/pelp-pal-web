import { describe, expect, it } from 'vitest';
import { verifyFlutterArgon2id } from '@/lib/auth/local-auth';

const fixture = '$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$-F2NoNJvnM2HQ9iXx5w_BIuiK0QtmgyVJypaTF3Gty4';

describe('Flutter Argon2id compatibility', () => {
  it('verifies the shared Flutter-format vector', async () => {
    await expect(verifyFlutterArgon2id('demo-password', fixture)).resolves.toBe(true);
    await expect(verifyFlutterArgon2id('wrong-password', fixture)).resolves.toBe(false);
  });

  it('rejects malformed or unsupported hashes without throwing', async () => {
    await expect(verifyFlutterArgon2id('demo-password', 'not-a-hash')).resolves.toBe(false);
    await expect(
      verifyFlutterArgon2id('demo-password', fixture.replace('v=19', 'v=16')),
    ).resolves.toBe(false);
  });
});
