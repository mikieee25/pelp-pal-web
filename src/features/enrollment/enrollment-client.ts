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

function isEnrollmentResponse(value: unknown): value is EnrollmentResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.organization_id === 'string' &&
    typeof response.assigned_username === 'string' &&
    (response.assigned_role === 'admin' || response.assigned_role === 'epred' || response.assigned_role === 'guest') &&
    (response.catalog_scope === 'masterlist' || response.catalog_scope === 'guestlist')
  );
}

export class DeviceAlreadyEnrolledError extends Error {
  constructor() {
    super('Browser is already enrolled.');
    this.name = 'DeviceAlreadyEnrolledError';
  }
}

async function getFunctionErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object' && 'clone' in context && typeof context.clone === 'function') {
      try {
        const response = context.clone() as Response;
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) {
          return body.error;
        }
      } catch {
        // Fall back to the SDK error message when the response is not JSON.
      }
    }
  }

  return error instanceof Error ? error.message : 'Unknown enrollment error.';
}

async function restoreExistingDeviceEnrollment(
  client: SupabaseClient,
  repository: LocalRepository,
  authUserId: string,
): Promise<void> {
  try {
    const { data, error } = await client
      .from('devices')
      .select('organization_id, assigned_username, assigned_role, catalog_scope')
      .eq('id', authUserId)
      .maybeSingle();

    if (error || !isEnrollmentResponse(data)) return;

    await repository.markDeviceEnrolled({
      authUserId,
      organizationId: data.organization_id,
      assignedUsername: data.assigned_username,
      assignedRole: data.assigned_role,
      catalogScope: data.catalog_scope,
    });
  } catch {
    // Preserve the duplicate-enrollment message if remote recovery is unavailable.
  }
}

export async function enrollBrowserDevice(
  client: SupabaseClient,
  repository: LocalRepository,
  request: EnrollmentRequest,
): Promise<EnrollmentResponse> {
  const session = await ensureAnonymousSession(client);
  const { data, error } = await client.functions.invoke<EnrollmentResponse>('enroll-device', { body: request });
  if (error) {
    const message = await getFunctionErrorMessage(error);
    if (message === 'Device already enrolled') {
      await restoreExistingDeviceEnrollment(client, repository, session.user.id);
      throw new DeviceAlreadyEnrolledError();
    }
    throw new Error(`Device enrollment failed: ${message}`);
  }
  if (!isEnrollmentResponse(data)) {
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
