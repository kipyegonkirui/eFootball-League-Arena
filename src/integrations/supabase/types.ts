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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      payment_submissions: {
        Row: {
          amount_kes: number
          created_at: string
          expected_fee_kes: number
          id: string
          method: string
          payer_phone: string
          registration_id: string
          screenshot_path: string | null
          status: Database["public"]["Enums"]["registration_status"]
          transaction_code: string
        }
        Insert: {
          amount_kes: number
          created_at?: string
          expected_fee_kes: number
          id?: string
          method?: string
          payer_phone: string
          registration_id: string
          screenshot_path?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          transaction_code: string
        }
        Update: {
          amount_kes?: number
          created_at?: string
          expected_fee_kes?: number
          id?: string
          method?: string
          payer_phone?: string
          registration_id?: string
          screenshot_path?: string | null
          status?: Database["public"]["Enums"]["registration_status"]
          transaction_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_submissions_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          game_mode: string
          league_format: string | null
          season_id: string
          efootball_id: string | null
          team_name: string | null
          gamer_tag: string
          group_id: string | null
          id: string
          phone: string
          platform: string
          reference: string
          slot_number: number | null
          status: Database["public"]["Enums"]["registration_status"]
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          game_mode: string
          efootball_id?: string | null
          team_name?: string | null
          gamer_tag: string
          group_id?: string | null
          id?: string
          phone: string
          platform: string
          reference: string
          slot_number?: number | null
          status?: Database["public"]["Enums"]["registration_status"]
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          game_mode?: string
          league_format?: string | null
          season_id?: string
          efootball_id?: string | null
          team_name?: string | null
          gamer_tag?: string
          group_id?: string | null
          id?: string
          phone?: string
          platform?: string
          reference?: string
          slot_number?: number | null
          status?: Database["public"]["Enums"]["registration_status"]
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "tournament_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_groups: {
        Row: {
          capacity: number
          created_at: string
          group_number: number
          id: string
          is_full: boolean
          league_format: string | null
          verified_count: number
        }
        Insert: {
          capacity?: number
          created_at?: string
          group_number: number
          id?: string
          is_full?: boolean
          league_format?: string | null
          verified_count?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          group_number?: number
          id?: string
          is_full?: boolean
          league_format?: string | null
          verified_count?: number
        }
        Relationships: []
      }
      tournament_settings: {
        Row: {
          description: string
          fee_kes: number
          group_capacity: number
          id: number
          max_groups: number
          prize_first_pct: number
          prize_percent: number
          prize_second_pct: number
          prize_third_pct: number
          mpesa_account_reference: string | null
          mpesa_paybill: string | null
          mpesa_till: string | null
          name: string
          payment_instructions: string | null
          registration_open: boolean
          start_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string
          fee_kes?: number
          group_capacity?: number
          id?: number
          max_groups?: number
          prize_first_pct?: number
          prize_percent?: number
          prize_second_pct?: number
          prize_third_pct?: number
          mpesa_account_reference?: string | null
          mpesa_paybill?: string | null
          mpesa_till?: string | null
          name?: string
          payment_instructions?: string | null
          registration_open?: boolean
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string
          fee_kes?: number
          group_capacity?: number
          id?: number
          max_groups?: number
          prize_first_pct?: number
          prize_percent?: number
          prize_second_pct?: number
          prize_third_pct?: number
          mpesa_account_reference?: string | null
          mpesa_paybill?: string | null
          mpesa_till?: string | null
          name?: string
          payment_instructions?: string | null
          registration_open?: boolean
          start_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      verification_audit: {
        Row: {
          actor_id: string | null
          actor_kind: string
          amount_kes: number | null
          created_at: string
          decision: string
          group_number: number | null
          id: string
          reason: string | null
          registration_id: string
          slot_number: number | null
          submission_id: string | null
          transaction_code: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          amount_kes?: number | null
          created_at?: string
          decision: string
          group_number?: number | null
          id?: string
          reason?: string | null
          registration_id: string
          slot_number?: number | null
          submission_id?: string | null
          transaction_code?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          amount_kes?: number | null
          created_at?: string
          decision?: string
          group_number?: number | null
          id?: string
          reason?: string | null
          registration_id?: string
          slot_number?: number | null
          submission_id?: string | null
          transaction_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_audit_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_audit_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          created_at: string
          email: string | null
          gamer_tag: string
          id: string
          phone: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          gamer_tag: string
          id?: string
          phone: string
        }
        Update: {
          created_at?: string
          email?: string | null
          gamer_tag?: string
          id?: string
          phone?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_verification: {
        Args: {
          _actor: string
          _actor_kind: string
          _decision: string
          _reason: string
          _registration_id: string
        }
        Returns: Json
      }
      admin_decide_registration: {
        Args: { _decision: string; _reason: string; _registration_id: string }
        Returns: Json
      }
      admin_update_settings: { Args: { _patch: Json }; Returns: undefined }
      get_public_tournament: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      join_waitlist: {
        Args: { _email: string; _gamer_tag: string; _phone: string }
        Returns: Json
      }
      lookup_registration: {
        Args: { _phone: string; _reference: string }
        Returns: Json
      }
      normalize_ke_phone: { Args: { _p: string }; Returns: string }
      submit_registration: {
        Args: {
          _amount_kes: number
          _efootball_id: string
          _email: string
          _full_name: string
          _game_mode: string
          _gamer_tag: string
          _payer_phone: string
          _phone: string
          _platform: string
          _league_format: string
          _screenshot_path: string
          _team_name: string
          _transaction_code: string
        }
        Returns: Json
      }
      verified_total: { Args: never; Returns: number }
      prize_breakdown: { Args: { _season?: string }; Returns: Json }
      get_public_league: { Args: { _season?: number }; Returns: Json }
      admin_end_season: { Args: { _season: number }; Returns: Json }
      admin_create_trial_codes: { Args: { _count: number; _hours: number; _label: string; _max_uses?: number }; Returns: Json }
      admin_list_trial_codes: { Args: never; Returns: Json }
      admin_revoke_trial_code: { Args: { _code: string }; Returns: Json }
      admin_remove_player: { Args: { _reason: string; _registration_id: string }; Returns: Json }
      admin_set_round_deadlines: { Args: { _first_due: string; _rounds_per_day: number; _season: number }; Returns: Json }
      get_round_deadlines: { Args: { _season: number }; Returns: Json }
      get_next_match_contact: { Args: { _phone: string; _reference: string }; Returns: Json }
      get_match_contact: { Args: { _fixture_id: string; _phone: string; _reference: string }; Returns: Json }
      submit_match_screenshot: { Args: { _fixture_id: string; _path: string; _phone: string; _reference: string }; Returns: Json }
      my_match_screenshots: { Args: { _phone: string; _reference: string }; Returns: Json }
      admin_match_screenshots: { Args: never; Returns: Json }
      get_public_fixtures: { Args: never; Returns: Json }
      raise_dispute: {
        Args: { _fixture_id: string; _note: string; _phone: string; _reference: string }
        Returns: Json
      }
      admin_generate_fixtures: { Args: never; Returns: Json }
      admin_record_result: {
        Args: { _away: number; _fixture_id: string; _home: number; _reason?: string; _result_type?: string }
        Returns: Json
      }
      admin_resolve_dispute: {
        Args: { _away: number; _fixture_id: string; _home: number; _note: string }
        Returns: Json
      }
      admin_league_overview: { Args: { _season?: number }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "user"
      registration_status: "pending" | "verified" | "rejected"
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
    Enums: {
      app_role: ["admin", "user"],
      registration_status: ["pending", "verified", "rejected"],
    },
  },
} as const
