import { describe, expect, it, vi } from 'vitest';
import { enrollBrowserDevice } from '@/features/enrollment/enrollment-client';

const mocks = vi.hoisted(() => ({
  ensureAnonymousSession: vi.fn(),
  markDeviceEnrolled: vi.fn(),
}));

vi.mock('@/lib/auth/session-bootstrap', () => ({
  ensureAnonymousSession: mocks.ensureAnonymousSession,
}));

describe('enrollBrowserDevice', () => {
  it('surfaces the structured already-enrolled error', async () => {
    mocks.ensureAnonymousSession.mockResolvedValue({ user: { id: 'device-1', is_anonymous: true } });
    mocks.markDeviceEnrolled.mockResolvedValue(undefined);

    const client = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: {
              clone: () => ({
                json: async () => ({ error: 'Device already enrolled' }),
              }),
            },
          },
        }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            organization_id: 'org-1',
            assigned_username: 'sample',
            assigned_role: 'admin',
            catalog_scope: 'masterlist',
          },
          error: null,
        }),
      }),
    };

    await expect(enrollBrowserDevice(
      client as never,
      { markDeviceEnrolled: mocks.markDeviceEnrolled } as never,
      {
      code: '404487',
      installation_id: 'installation-1',
      app_version: '0.1.0',
      platform: 'web',
    },
    )).rejects.toMatchObject({
      name: 'DeviceAlreadyEnrolledError',
      message: 'Browser is already enrolled.',
    });
    expect(mocks.markDeviceEnrolled).toHaveBeenCalledWith({
      authUserId: 'device-1',
      organizationId: 'org-1',
      assignedUsername: 'sample',
      assignedRole: 'admin',
      catalogScope: 'masterlist',
    });
  });
});
