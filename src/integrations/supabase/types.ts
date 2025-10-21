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
      manual_service_steps: {
        Row: {
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
          id: string
          last_analysis: string | null
          last_bpmn_export: string | null
          last_edited: string
          last_form_export: string | null
          name: string
          performer_org: string
          performing_team: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_analysis?: string | null
          last_bpmn_export?: string | null
          last_edited?: string
          last_form_export?: string | null
          name: string
          performer_org: string
          performing_team: string
        }
        Update: {
          created_at?: string
          id?: string
          last_analysis?: string | null
          last_bpmn_export?: string | null
          last_edited?: string
          last_form_export?: string | null
          name?: string
          performer_org?: string
          performing_team?: string
        }
        Relationships: []
      }
      subprocess_steps: {
        Row: {
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
          id: string
          name: string
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
