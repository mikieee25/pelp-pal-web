import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Database } from '@/lib/supabase/database.types';

export type EnrollmentCode = {
  code: string;
  assignedUsername: string;
  expiresAt: string;
};

export type EnrollmentCodeClient = {
  issue(targetUsername: string): Promise<EnrollmentCode>;
};

type RemoteEnrollmentCode = {
  code: string;
  assigned_username: string;
  expires_at: string;
};

function isRemoteEnrollmentCode(value: unknown): value is RemoteEnrollmentCode {
  if (!value || typeof value !== 'object') return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.code === 'string' && /^\d{6}$/.test(response.code) &&
    typeof response.assigned_username === 'string' && response.assigned_username.length > 0 &&
    typeof response.expires_at === 'string' && !Number.isNaN(Date.parse(response.expires_at))
  );
}

async function readFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: unknown };
        if (typeof body.error === 'string' && body.error.trim()) return body.error;
      } catch {
        // Use the SDK message when the response is not JSON.
      }
    }
  }

  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Enrollment code request failed.';
}

export function createEnrollmentCodeClient(
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
): EnrollmentCodeClient {
  return {
    async issue(targetUsername) {
      const username = targetUsername.trim().toLowerCase();
      if (!username) throw new Error('Target username is required.');

      const { data, error } = await client.functions.invoke<RemoteEnrollmentCode>('issue-enrollment-code', {
        body: { target_username: username },
      });
      if (error) throw new Error(await readFunctionError(error));
      if (!isRemoteEnrollmentCode(data)) {
        throw new Error('Enrollment code request returned an incomplete response.');
      }

      return {
        code: data.code,
        assignedUsername: data.assigned_username,
        expiresAt: data.expires_at,
      };
    },
  };
}
