import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { Database } from '@/lib/supabase/database.types';

export type PersonnelRole = 'admin' | 'epred' | 'guest';
export type PersonnelStatus = 'active' | 'deactivated' | 'archived';

export type Personnel = {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  role: PersonnelRole;
  isActive: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  mustChangePassword: boolean;
  updatedAt: string;
};

export type CreatePersonnelInput = {
  displayName: string;
  username: string;
  temporaryPassword: string;
  role: PersonnelRole;
};

export type PersonnelClient = {
  list(includeArchived?: boolean): Promise<Personnel[]>;
  create(input: CreatePersonnelInput): Promise<Personnel>;
  resetPassword(id: string, temporaryPassword: string): Promise<void>;
  deactivate(id: string): Promise<Personnel>;
  archive(id: string): Promise<Personnel>;
  restore(id: string): Promise<Personnel>;
  delete(id: string, confirm: true): Promise<void>;
};

type RemotePersonnel = {
  id: string;
  organization_id: string;
  username: string;
  display_name: string;
  role: PersonnelRole;
  is_active: boolean;
  archived_at: string | null;
  archived_by: string | null;
  must_change_password: boolean;
  updated_at: string;
};

type PersonnelResponse = { personnel: RemotePersonnel[] };
type PersonnelMutationResponse = { personnel: RemotePersonnel };

export function createPersonnelClient(
  client: SupabaseClient<Database> = getSupabaseBrowserClient(),
): PersonnelClient {
  const invoke = async <T>(body: Record<string, unknown>, fallback: string): Promise<T> => {
    const { data, error } = await client.functions.invoke<T>('personnel-management', { body });
    if (error || !data) throw new Error(error?.message ?? fallback);
    return data;
  };

  const mutation = async (body: Record<string, unknown>, fallback: string) => {
    const response = await invoke<PersonnelMutationResponse>(body, fallback);
    return mapPersonnel(response.personnel);
  };

  return {
    async list(includeArchived = false) {
      const response = await invoke<PersonnelResponse>(
        { action: 'list', include_archived: includeArchived },
        'Could not load personnel.',
      );
      return response.personnel.map(mapPersonnel);
    },
    async create(input) {
      const response = await mutation({
        action: 'create',
        display_name: input.displayName.trim(),
        username: input.username.trim().toLowerCase(),
        temporary_password: input.temporaryPassword,
        role: input.role,
      }, 'Personnel account creation failed.');
      return response;
    },
    async resetPassword(id, temporaryPassword) {
      await invoke({ action: 'reset_password', target_id: id, temporary_password: temporaryPassword }, 'Password reset failed.');
    },
    async deactivate(id) {
      return mutation({ action: 'deactivate', target_id: id }, 'Personnel deactivation failed.');
    },
    async archive(id) {
      return mutation({ action: 'archive', target_id: id }, 'Personnel archive failed.');
    },
    async restore(id) {
      return mutation({ action: 'restore', target_id: id }, 'Personnel restore failed.');
    },
    async delete(id, confirm) {
      await invoke({ action: 'delete', target_id: id, confirm }, 'Personnel deletion failed.');
    },
  };
}

function mapPersonnel(value: RemotePersonnel): Personnel {
  return {
    id: value.id,
    organizationId: value.organization_id,
    username: value.username,
    displayName: value.display_name,
    role: value.role,
    isActive: value.is_active,
    archivedAt: value.archived_at,
    archivedBy: value.archived_by,
    mustChangePassword: value.must_change_password,
    updatedAt: value.updated_at,
  };
}
