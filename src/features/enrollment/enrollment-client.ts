import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocalRepository } from '@/lib/db/repository';
import { ensureAnonymousSession } from '@/lib/auth/session-bootstrap';
import type { EnrollmentRequest } from './enrollment-service';

type EnrollmentResponse = {
  organization_id: string;
  assigned_username: string;
  assigned_role: 'admin' | 'epred' | 'guest';
  catalog_scope: 'masterlist' | 'guestlist';
};

export async function enrollBrowserDevice(
  client: SupabaseClient,
  repository: LocalRepository,
  request: EnrollmentRequest,
): Promise<EnrollmentResponse> {
  const session = await ensureAnonymousSession(client);
  const { data, error } = await client.functions.invoke<EnrollmentResponse>('enroll-device', { body: request });
  if (error) throw new Error(`Device enrollment failed: ${error.message}`);
  if (!data?.organization_id || !data.assigned_username || !data.assigned_role || !data.catalog_scope) {
    throw new Error('Device enrollment returned an incomplete response.');
  }
  await repository.markDeviceEnrolled({
    authUserId: session.user.id,
    organizationId: data.organization_id,
    assignedUsername: data.assigned_username,
    assignedRole: data.assigned_role,
    catalogScope: data.catalog_scope,
  });
  return data;
}
