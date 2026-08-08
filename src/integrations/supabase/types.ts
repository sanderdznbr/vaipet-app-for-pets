export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          email: string | null
          phone: string | null
          bio: string | null
          avatar_url: string | null
          role: string | null
          onboarding_completed: boolean | null
          age: number | null
          birthday: string | null
          created_at: string | null
          updated_at: string | null
          signup_intent: string | null
        }
        Insert: {
          id: string
          full_name?: string | null
          email?: string | null
          phone?: string | null
          bio?: string | null
          avatar_url?: string | null
          role?: string | null
          onboarding_completed?: boolean | null
          age?: number | null
          birthday?: string | null
          created_at?: string | null
          updated_at?: string | null
          signup_intent?: string | null
        }
        Update: {
          id?: string
          full_name?: string | null
          email?: string | null
          phone?: string | null
          bio?: string | null
          avatar_url?: string | null
          role?: string | null
          onboarding_completed?: boolean | null
          age?: number | null
          birthday?: string | null
          created_at?: string | null
          updated_at?: string | null
          signup_intent?: string | null
        }
      }
      petwalker_profiles: {
        Row: {
          user_id: string
          public_bio: string | null
          experience_years: number | null
          service_radius_km: number | null
          price_30_minutes: number | null
          rating_average: number | null
          completed_walks: number | null
          cancellation_rate: number | null
          is_accepting_requests: boolean | null
          availability_status: string | null
          approval_status: string | null
          profile_completed: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          user_id: string
          public_bio?: string | null
          experience_years?: number | null
          service_radius_km?: number | null
          price_30_minutes?: number | null
          rating_average?: number | null
          completed_walks?: number | null
          cancellation_rate?: number | null
          is_accepting_requests?: boolean | null
          availability_status?: string | null
          approval_status?: string | null
          profile_completed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          public_bio?: string | null
          experience_years?: number | null
          service_radius_km?: number | null
          price_30_minutes?: number | null
          rating_average?: number | null
          completed_walks?: number | null
          cancellation_rate?: number | null
          is_accepting_requests?: boolean | null
          availability_status?: string | null
          approval_status?: string | null
          profile_completed?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      petwalker_applications: {
        Row: {
          id: string
          user_id: string
          legal_name: string
          birth_date: string
          phone: string
          city: string
          experience_description: string
          emergency_contact_name: string
          emergency_contact_phone: string
          status: string | null
          rejection_reason: string | null
          document_status: string | null
          submitted_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          legal_name: string
          birth_date: string
          phone: string
          city: string
          experience_description: string
          emergency_contact_name: string
          emergency_contact_phone: string
          status?: string | null
          rejection_reason?: string | null
          document_status?: string | null
          submitted_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          legal_name?: string
          birth_date?: string
          phone?: string
          city?: string
          experience_description?: string
          emergency_contact_name?: string
          emergency_contact_phone?: string
          status?: string | null
          rejection_reason?: string | null
          document_status?: string | null
          submitted_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_roles: {
        Row: {
          id: string
          user_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          id?: string
          user_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          id?: string
          user_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      update_petwalker_operational_profile: {
        Args: {
          _public_bio: string
          _experience_years: number
          _service_radius_km: number
          _price_30_minutes: number
        }
        Returns: undefined
      }
      get_admin_application_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          pending_count: number
          approved_count: number
          rejected_count: number
        }[]
      }
      get_petwalker_application_admin: {
        Args: {
          _application_id: string
        }
        Returns: {
          id: string
          legal_name: string
          birth_date: string
          phone: string
          city: string
          experience_description: string
          emergency_contact_name: string
          emergency_contact_phone: string
          document_status: string
          status: string
          rejection_reason: string
          submitted_at: string
          reviewed_at: string
        }[]
      }
      get_petwalker_applications_admin: {
        Args: {
          _status?: string
        }
        Returns: {
          id: string
          legal_name: string
          city: string
          status: string
          document_status: string
          submitted_at: string
          reviewed_at: string
        }[]
      }
      ensure_current_user_profile: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      has_role: {
        Args: {
          _user_id: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      approve_petwalker_application: {
        Args: {
          application_id: string
        }
        Returns: undefined
      }
      set_signup_intent: {
        Args: {
          _intent: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "petshop" | "petwalker"
      application_status: "pending" | "approved" | "rejected"
    }
  }
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database["public"]["Tables"] & Database["public"]["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database["public"]["Tables"] &
        Database["public"]["Views"])
    ? (Database["public"]["Tables"] &
        Database["public"]["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
    ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database["public"]["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database["public"]["Tables"]
    ? Database["public"]["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database["public"]["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof Database["public"]["Enums"]
    ? Database["public"]["Enums"][PublicEnumNameOrOptions]
    : never
