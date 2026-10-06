import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createPersonnelClient } from '@/features/personnel/personnel-client';

const remote = {
  id: 'person-1', organization_id: 'org-1', username: 'epred.one', display_name: 'EPRED One', role: 'epred',
  is_active: true, archived_at: null, archived_by: null, must_change_password: true, updated_at: '2026-10-06T00:00:00Z',
};

function mockClient(responses: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const invoke = vi.fn();
  for (const response of responses) invoke.mockResolvedValueOnce(response);
  return { functions: { invoke } } as unknown as SupabaseClient<Database>;
}

describe('personnel client', () => {
  it('lists and maps safe snake_case fields', async () => {
    const client = mockClient([{ data: { personnel: [remote] }, error: null }]);
    const result = await createPersonnelClient(client).list();
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'person-1', organizationId: 'org-1', displayName: 'EPRED One', role: 'epred',
    }));
    expect(client.functions.invoke).toHaveBeenCalledWith('personnel-management', {
      body: { action: 'list', include_archived: false },
    });
  });

  it('sends create fields and never returns the temporary password', async () => {
    const client = mockClient([{ data: { personnel: [remote] }, error: null }]);
    await createPersonnelClient(client).create({ displayName: 'EPRED One', username: ' EPRED.One ', temporaryPassword: 'secret123', role: 'epred' });
    expect(client.functions.invoke).toHaveBeenCalledWith('personnel-management', {
      body: { action: 'create', display_name: 'EPRED One', username: 'epred.one', temporary_password: 'secret123', role: 'epred' },
    });
  });

  it('sends lifecycle actions with target ids', async () => {
    const client = mockClient([
      { data: { personnel: [remote] }, error: null },
      { data: { personnel: [remote] }, error: null },
      { data: { personnel: [remote] }, error: null },
      { data: { personnel: [remote] }, error: null },
      { data: { ok: true }, error: null },
    ]);
    const api = createPersonnelClient(client);
    await api.deactivate('person-1');
    await api.archive('person-1');
    await api.restore('person-1');
    await api.resetPassword('person-1', 'new-secret');
    await api.delete('person-1', true);
    expect(client.functions.invoke).toHaveBeenNthCalledWith(1, 'personnel-management', { body: { action: 'deactivate', target_id: 'person-1' } });
    expect(client.functions.invoke).toHaveBeenNthCalledWith(4, 'personnel-management', { body: { action: 'reset_password', target_id: 'person-1', temporary_password: 'new-secret' } });
    expect(client.functions.invoke).toHaveBeenNthCalledWith(5, 'personnel-management', { body: { action: 'delete', target_id: 'person-1', confirm: true } });
  });

  it('turns function failures into actionable errors', async () => {
    const client = mockClient([{ data: null, error: { message: 'Administrator access required.' } }]);
    await expect(createPersonnelClient(client).list()).rejects.toThrow(/administrator access required/i);
  });
});
