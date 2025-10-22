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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      documents: {
        Row: {
          created_at: string | null
          downloaded_at: string | null
          error_message: string | null
          file_path: string | null
          id: string
          is_decision_sheet: boolean | null
          service_external_id: string
          source_url: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          downloaded_at?: string | null
          error_message?: string | null
          file_path?: string | null
          id?: string
          is_decision_sheet?: boolean | null
          service_external_id: string
          source_url: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          downloaded_at?: string | null
          error_message?: string | null
          file_path?: string | null
          id?: string
          is_decision_sheet?: boolean | null
          service_external_id?: string
          source_url?: string
          status?: string | null
        }
        Relationships: []
      }
      exports: {
        Row: {
          completed_at: string | null
          created_at: string
          download_url: string | null
          id: string
          service_id: string
          status: string
          type: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          download_url?: string | null
          id?: string
          service_id: string
          status?: string
          type: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          download_url?: string | null
          id?: string
          service_id?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "exports_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "manual_services"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          created_at: string
          file_name: string
          id: string
          last_updated: string
          template_name: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          last_updated?: string
          template_name: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          last_updated?: string
          template_name?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          job_type: string
          progress: number | null
          service_external_id: string
          started_at: string | null
          status: string | null
          total: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_type: string
          progress?: number | null
          service_external_id: string
          started_at?: string | null
          status?: string | null
          total?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          job_type?: string
          progress?: number | null
          service_external_id?: string
          started_at?: string | null
          status?: string | null
          total?: number | null
        }
        Relationships: []
      }
      manual_service_steps: {
        Row: {
          candidate_group: string | null
          connections: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          original_order: number
          service_id: string
          step_order: number
          subprocess_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_group?: string | null
          connections?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          original_order: number
          service_id: string
          step_order: number
          subprocess_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_group?: string | null
          connections?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          original_order?: number
          service_id?: string
          step_order?: number
          subprocess_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_service_steps_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "manual_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_service_steps_subprocess_id_fkey"
            columns: ["subprocess_id"]
            isOneToOne: false
            referencedRelation: "subprocesses"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_services: {
        Row: {
          created_at: string
          edited_bpmn_xml: string | null
          id: string
          last_analysis: string | null
          last_bpmn_export: string | null
          last_edited: string
          last_form_export: string | null
          name: string
          original_bpmn_xml: string | null
          performer_org: string
          performing_team: string
        }
        Insert: {
          created_at?: string
          edited_bpmn_xml?: string | null
          id?: string
          last_analysis?: string | null
          last_bpmn_export?: string | null
          last_edited?: string
          last_form_export?: string | null
          name: string
          original_bpmn_xml?: string | null
          performer_org: string
          performing_team: string
        }
        Update: {
          created_at?: string
          edited_bpmn_xml?: string | null
          id?: string
          last_analysis?: string | null
          last_bpmn_export?: string | null
          last_edited?: string
          last_form_export?: string | null
          name?: string
          original_bpmn_xml?: string | null
          performer_org?: string
          performing_team?: string
        }
        Relationships: []
      }
      mds_data: {
        Row: {
          candidate_group: string | null
          decision_sheet_urls: string | null
          id: string
          imported_at: string | null
          performer_org: string
          performing_team: string
          process_step: number | null
          row_hash: string
          service_external_id: string
          service_name: string
          sop_urls: string | null
          step_external_id: string
          step_name: string
          type: string
        }
        Insert: {
          candidate_group?: string | null
          decision_sheet_urls?: string | null
          id?: string
          imported_at?: string | null
          performer_org: string
          performing_team: string
          process_step?: number | null
          row_hash: string
          service_external_id: string
          service_name: string
          sop_urls?: string | null
          step_external_id: string
          step_name: string
          type: string
        }
        Update: {
          candidate_group?: string | null
          decision_sheet_urls?: string | null
          id?: string
          imported_at?: string | null
          performer_org?: string
          performing_team?: string
          process_step?: number | null
          row_hash?: string
          service_external_id?: string
          service_name?: string
          sop_urls?: string | null
          step_external_id?: string
          step_name?: string
          type?: string
        }
        Relationships: []
      }
      subprocess_steps: {
        Row: {
          candidate_group: string | null
          connections: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          original_order: number
          step_order: number
          subprocess_id: string
          updated_at: string
        }
        Insert: {
          candidate_group?: string | null
          connections?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          original_order: number
          step_order: number
          subprocess_id: string
          updated_at?: string
        }
        Update: {
          candidate_group?: string | null
          connections?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          original_order?: number
          step_order?: number
          subprocess_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subprocess_steps_subprocess_id_fkey"
            columns: ["subprocess_id"]
            isOneToOne: false
            referencedRelation: "subprocesses"
            referencedColumns: ["id"]
          },
        ]
      }
      subprocesses: {
        Row: {
          created_at: string
          edited_bpmn_xml: string | null
          id: string
          name: string
          original_bpmn_xml: string | null
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          edited_bpmn_xml?: string | null
          id?: string
          name: string
          original_bpmn_xml?: string | null
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          edited_bpmn_xml?: string | null
          id?: string
          name?: string
          original_bpmn_xml?: string | null
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subprocesses_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "manual_services"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
