import { describe, expect, it } from 'vitest';
import { minimumPasswordLength, isValidPassword } from '@/features/auth/password-policy';

describe('account password policy', () => {
  it('requires at least ten characters, or twelve for administrators', () => {
    expect(minimumPasswordLength('epred')).toBe(10);
    expect(minimumPasswordLength('admin')).toBe(12);
    expect(isValidPassword('1234567890', 'epred')).toBe(true);
    expect(isValidPassword('1234567890', 'admin')).toBe(false);
    expect(isValidPassword('123456789012', 'admin')).toBe(true);
    expect(isValidPassword('x'.repeat(129), 'admin')).toBe(false);
  });
});
