import { describe, expect, it } from 'vitest';
import { buildEnrollmentRequest } from '@/features/enrollment/enrollment-service';

describe('buildEnrollmentRequest', () => {
  it('normalizes the web enrollment payload', () => {
    expect(buildEnrollmentRequest(' CODE-1 ', 'installation-1', '0.1.0')).toEqual({
      code: 'CODE-1',
      installation_id: 'installation-1',
      platform: 'web',
      app_version: '0.1.0',
    });
  });

  it('rejects incomplete enrollment input', () => {
    expect(() => buildEnrollmentRequest('', 'installation-1', '0.1.0')).toThrow('Enrollment code is required.');
  });
});
