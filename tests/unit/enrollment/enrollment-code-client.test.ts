import { describe, expect, it, vi } from 'vitest';
import { createEnrollmentCodeClient } from '@/features/enrollment/enrollment-code-client';

function createClient() {
  return {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
  };
}

describe('EnrollmentCodeClient', () => {
  it('normalizes the target username and maps the response', async () => {
    const client = createClient();
    client.functions.invoke.mockResolvedValue({
      data: {
        code: '123456',
        assigned_username: 'epred.one',
        expires_at: '2026-10-13T00:00:00.000Z',
      },
      error: null,
    });

    await expect(createEnrollmentCodeClient(client as never).issue(' EPRED.One ')).resolves.toEqual({
      code: '123456',
      assignedUsername: 'epred.one',
      expiresAt: '2026-10-13T00:00:00.000Z',
    });
    expect(client.functions.invoke).toHaveBeenCalledWith('issue-enrollment-code', {
      body: { target_username: 'epred.one' },
    });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed responses with an incomplete-response error', async () => {
    const client = createClient();
    client.functions.invoke.mockResolvedValue({ data: { code: '12' }, error: null });

    await expect(createEnrollmentCodeClient(client as never).issue('epred.one'))
      .rejects.toThrow('Enrollment code request returned an incomplete response.');
  });

  it('surfaces a structured backend error without exposing credentials', async () => {
    const client = createClient();
    const response = new Response(JSON.stringify({ error: 'Administrator access required.' }), { status: 403 });
    client.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: response },
    });

    await expect(createEnrollmentCodeClient(client as never).issue('epred.one'))
      .rejects.toThrow('Administrator access required.');
    await expect(createEnrollmentCodeClient(client as never).issue('epred.one'))
      .rejects.not.toThrow(/service|secret|password/i);
  });
});
