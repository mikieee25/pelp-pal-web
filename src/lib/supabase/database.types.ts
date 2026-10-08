export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_reset_commands: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          issued_by_device_id: string
          masterlist_cipher_text: string | null
          masterlist_mac: string | null
          masterlist_nonce: string | null
          masterlist_salt: string | null
          organization_id: string
          password_hash: string
          target_username: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          issued_by_device_id: string
          masterlist_cipher_text?: string | null
          masterlist_mac?: string | null
          masterlist_nonce?: string | null
          masterlist_salt?: string | null
          organization_id: string
          password_hash: string
          target_username: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          issued_by_device_id?: string
          masterlist_cipher_text?: string | null
          masterlist_mac?: string | null
          masterlist_nonce?: string | null
          masterlist_salt?: string | null
          organization_id?: string
          password_hash?: string
          target_username?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_reset_commands_issued_by_device_id_fkey"
            columns: ["issued_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          change_cursor: number
          client_created_at: string
          device_id: string
          event_type: string
          id: string
          inspection_id: string | null
          inspection_revision_id: string | null
          organization_id: string
          payload: Json
          server_created_at: string
          username: string
        }
        Insert: {
          change_cursor?: number
          client_created_at: string
          device_id: string
          event_type: string
          id: string
          inspection_id?: string | null
          inspection_revision_id?: string | null
          organization_id: string
          payload: Json
          server_created_at?: string
          username: string
        }
        Update: {
          change_cursor?: number
          client_created_at?: string
          device_id?: string
          event_type?: string
          id?: string
          inspection_id?: string | null
          inspection_revision_id?: string | null
          organization_id?: string
          payload?: Json
          server_created_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_manifests: {
        Row: {
          catalog_role: string
          id: string
          integrity_hash: string
          organization_id: string
          published_at: string
          row_count: number
          schema_version: number
          storage_path: string
          version: number
        }
        Insert: {
          catalog_role: string
          id?: string
          integrity_hash: string
          organization_id: string
          published_at?: string
          row_count: number
          schema_version: number
          storage_path: string
          version: number
        }
        Update: {
          catalog_role?: string
          id?: string
          integrity_hash?: string
          organization_id?: string
          published_at?: string
          row_count?: number
          schema_version?: number
          storage_path?: string
          version?: number
        }
        Relationships: []
      }
      device_enrollment_codes: {
        Row: {
          assigned_role: string
          assigned_username: string
          catalog_scope: string
          code_hash: string
          consumed_at: string | null
          consumed_by_device_id: string | null
          created_at: string
          expires_at: string
          id: string
          organization_id: string
        }
        Insert: {
          assigned_role: string
          assigned_username: string
          catalog_scope: string
          code_hash: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
        }
        Update: {
          assigned_role?: string
          assigned_username?: string
          catalog_scope?: string
          code_hash?: string
          consumed_at?: string | null
          consumed_by_device_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_enrollment_codes_consumed_by_device_id_fkey"
            columns: ["consumed_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string
          assigned_role: string
          assigned_username: string
          catalog_scope: string
          enrolled_at: string
          id: string
          installation_id: string
          last_sync_at: string | null
          organization_id: string
          platform: string
          revoked_at: string | null
        }
        Insert: {
          app_version: string
          assigned_role: string
          assigned_username: string
          catalog_scope: string
          enrolled_at?: string
          id: string
          installation_id: string
          last_sync_at?: string | null
          organization_id: string
          platform: string
          revoked_at?: string | null
        }
        Update: {
          app_version?: string
          assigned_role?: string
          assigned_username?: string
          catalog_scope?: string
          enrolled_at?: string
          id?: string
          installation_id?: string
          last_sync_at?: string | null
          organization_id?: string
          platform?: string
          revoked_at?: string | null
        }
        Relationships: []
      }
      inspection_conflicts: {
        Row: {
          actual_head_revision: number
          candidate_payload: Json
          candidate_revision_id: string
          change_cursor: number
          created_at: string
          expected_base_revision: number
          id: string
          inspection_id: string
          organization_id: string
          resolved_at: string | null
          resolved_revision_id: string | null
          status: string
        }
        Insert: {
          actual_head_revision: number
          candidate_payload: Json
          candidate_revision_id: string
          change_cursor?: number
          created_at?: string
          expected_base_revision: number
          id: string
          inspection_id: string
          organization_id: string
          resolved_at?: string | null
          resolved_revision_id?: string | null
          status: string
        }
        Update: {
          actual_head_revision?: number
          candidate_payload?: Json
          candidate_revision_id?: string
          change_cursor?: number
          created_at?: string
          expected_base_revision?: number
          id?: string
          inspection_id?: string
          organization_id?: string
          resolved_at?: string | null
          resolved_revision_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_conflicts_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_deletion_tombstones: {
        Row: {
          change_cursor: number
          deleted_at: string
          inspection_id: string
          organization_id: string
          owner_username: string
          product_control_number: string
          storage_paths: string[]
        }
        Insert: {
          change_cursor?: number
          deleted_at?: string
          inspection_id: string
          organization_id: string
          owner_username: string
          product_control_number: string
          storage_paths?: string[]
        }
        Update: {
          change_cursor?: number
          deleted_at?: string
          inspection_id?: string
          organization_id?: string
          owner_username?: string
          product_control_number?: string
          storage_paths?: string[]
        }
        Relationships: []
      }
      inspection_evidence: {
        Row: {
          captured_at: string
          created_at: string
          display_order: number
          export_file_name: string
          id: string
          inspection_id: string
          mime_type: string
          organization_id: string
          original_file_name: string
          product_control_number: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by_device_id: string
        }
        Insert: {
          captured_at: string
          created_at?: string
          display_order: number
          export_file_name: string
          id: string
          inspection_id: string
          mime_type: string
          organization_id: string
          original_file_name: string
          product_control_number: string
          sha256: string
          size_bytes: number
          storage_path: string
          uploaded_by_device_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          display_order?: number
          export_file_name?: string
          id?: string
          inspection_id?: string
          mime_type?: string
          organization_id?: string
          original_file_name?: string
          product_control_number?: string
          sha256?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by_device_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_evidence_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_evidence_uploaded_by_device_id_fkey"
            columns: ["uploaded_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_revisions: {
        Row: {
          base_revision: number
          change_cursor: number
          client_created_at: string
          edited_by_device_id: string
          edited_by_username: string
          id: string
          inspection_id: string
          organization_id: string
          parent_client_revision_id: string | null
          payload: Json
          revision: number
          server_created_at: string
        }
        Insert: {
          base_revision: number
          change_cursor?: number
          client_created_at: string
          edited_by_device_id: string
          edited_by_username: string
          id: string
          inspection_id: string
          organization_id: string
          parent_client_revision_id?: string | null
          payload: Json
          revision: number
          server_created_at?: string
        }
        Update: {
          base_revision?: number
          change_cursor?: number
          client_created_at?: string
          edited_by_device_id?: string
          edited_by_username?: string
          id?: string
          inspection_id?: string
          organization_id?: string
          parent_client_revision_id?: string | null
          payload?: Json
          revision?: number
          server_created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_revisions_edited_by_device_id_fkey"
            columns: ["edited_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_revisions_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          created_at: string
          current_revision: number
          current_revision_id: string
          id: string
          organization_id: string
          owner_device_id: string
          owner_username: string
          updated_at: string
        }
        Insert: {
          created_at: string
          current_revision: number
          current_revision_id: string
          id: string
          organization_id: string
          owner_device_id: string
          owner_username: string
          updated_at: string
        }
        Update: {
          created_at?: string
          current_revision?: number
          current_revision_id?: string
          id?: string
          organization_id?: string
          owner_device_id?: string
          owner_username?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_owner_device_id_fkey"
            columns: ["owner_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_accounts: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          auth_alias: string
          auth_user_id: string | null
          credential_version: number
          display_name: string
          id: string
          is_active: boolean
          must_change_password: boolean
          organization_id: string
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          auth_alias: string
          auth_user_id?: string | null
          credential_version?: number
          display_name: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          organization_id: string
          role: string
          updated_at?: string
          username: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          auth_alias?: string
          auth_user_id?: string | null
          credential_version?: number
          display_name?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          organization_id?: string
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_accounts_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "organization_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_alias_for_account: {
        Args: { p_account_id: string }
        Returns: string
      }
      bump_credential_version: {
        Args: { p_account_id: string }
        Returns: number
      }
      consume_account_reset: {
        Args: { p_command_id: string }
        Returns: boolean
      }
      current_account: { Args: never; Returns: Json }
      delete_inspection_sync: {
        Args: {
          p_inspection_id: string
          p_product_control_number: string
          p_storage_paths?: string[]
        }
        Returns: Json
      }
      enroll_device: {
        Args: {
          p_app_version: string
          p_code_hash: string
          p_installation_id: string
          p_platform: string
        }
        Returns: Json
      }
      generate_code:
        | {
            Args: { p_organization_id: string; p_username: string }
            Returns: Json
          }
        | { Args: { p_username: string }; Returns: string }
      publish_catalog_manifest: {
        Args: {
          p_catalog_role: string
          p_integrity_hash: string
          p_row_count: number
          p_schema_version: number
          p_storage_path: string
        }
        Returns: Json
      }
      pull_sync_changes: {
        Args: {
          p_activity_cursor: number
          p_conflict_cursor: number
          p_deletion_cursor?: number
          p_limit?: number
          p_revision_cursor: number
        }
        Returns: Json
      }
      push_activity_events: { Args: { p_events: Json }; Returns: Json }
      push_inspection_revisions: {
        Args: { p_events: Json; p_inspection_id: string; p_revisions: Json }
        Returns: Json
      }
      resolve_inspection_conflict: {
        Args: {
          p_conflict_id: string
          p_event: Json
          p_expected_head_revision: number
          p_inspection_id: string
          p_resolved_revision: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
