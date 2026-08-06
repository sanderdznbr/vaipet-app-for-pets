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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      breed_photos: {
        Row: {
          breed: string
          created_at: string
          id: string
          photo_url: string
        }
        Insert: {
          breed: string
          created_at?: string
          id?: string
          photo_url: string
        }
        Update: {
          breed?: string
          created_at?: string
          id?: string
          photo_url?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_default: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          postal_code: string | null
          state: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          postal_code?: string | null
          state?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_default?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          postal_code?: string | null
          state?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean
          message: string
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pet_documents: {
        Row: {
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          id: string
          mime_type: string
          notes: string | null
          pet_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          document_type: string
          file_name: string
          file_path: string
          file_size: number
          id?: string
          mime_type: string
          notes?: string | null
          pet_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          document_type?: string
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          mime_type?: string
          notes?: string | null
          pet_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pet_documents_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_models_3d: {
        Row: {
          breed: string
          created_at: string | null
          glb_url: string
          id: string
        }
        Insert: {
          breed: string
          created_at?: string | null
          glb_url: string
          id?: string
        }
        Update: {
          breed?: string
          created_at?: string | null
          glb_url?: string
          id?: string
        }
        Relationships: []
      }
      pets: {
        Row: {
          age: number | null
          avatar_url: string | null
          behavioral_notes: string | null
          breed: string
          created_at: string
          emergency_contact: string | null
          gender: string | null
          id: string
          is_active: boolean | null
          medical_info: string | null
          name: string
          owner_id: string
          updated_at: string
          weight: number | null
        }
        Insert: {
          age?: number | null
          avatar_url?: string | null
          behavioral_notes?: string | null
          breed: string
          created_at?: string
          emergency_contact?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          medical_info?: string | null
          name: string
          owner_id: string
          updated_at?: string
          weight?: number | null
        }
        Update: {
          age?: number | null
          avatar_url?: string | null
          behavioral_notes?: string | null
          breed?: string
          created_at?: string
          emergency_contact?: string | null
          gender?: string | null
          id?: string
          is_active?: boolean | null
          medical_info?: string | null
          name?: string
          owner_id?: string
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      petwalker_applications: {
        Row: {
          birth_date: string
          city: string
          created_at: string | null
          document_status: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          experience_description: string
          id: string
          legal_name: string
          phone: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          birth_date: string
          city: string
          created_at?: string | null
          document_status?: string | null
          emergency_contact_name: string
          emergency_contact_phone: string
          experience_description: string
          id?: string
          legal_name: string
          phone: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          birth_date?: string
          city?: string
          created_at?: string | null
          document_status?: string | null
          emergency_contact_name?: string
          emergency_contact_phone?: string
          experience_description?: string
          id?: string
          legal_name?: string
          phone?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      petwalker_earnings: {
        Row: {
          available_at: string | null
          created_at: string | null
          gross_amount: number
          id: string
          net_amount: number
          paid_at: string | null
          petwalker_id: string
          platform_fee: number
          status: string | null
          walk_session_id: string | null
        }
        Insert: {
          available_at?: string | null
          created_at?: string | null
          gross_amount: number
          id?: string
          net_amount: number
          paid_at?: string | null
          petwalker_id: string
          platform_fee: number
          status?: string | null
          walk_session_id?: string | null
        }
        Update: {
          available_at?: string | null
          created_at?: string | null
          gross_amount?: number
          id?: string
          net_amount?: number
          paid_at?: string | null
          petwalker_id?: string
          platform_fee?: number
          status?: string | null
          walk_session_id?: string | null
        }
        Relationships: []
      }
      petwalker_profiles: {
        Row: {
          approval_status: string | null
          availability_status: string | null
          cancellation_rate: number | null
          completed_walks: number | null
          created_at: string | null
          experience_years: number | null
          is_accepting_requests: boolean | null
          last_online_at: string | null
          price_30_minutes: number | null
          profile_completed: boolean | null
          public_bio: string | null
          rating_average: number | null
          service_radius_km: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          approval_status?: string | null
          availability_status?: string | null
          cancellation_rate?: number | null
          completed_walks?: number | null
          created_at?: string | null
          experience_years?: number | null
          is_accepting_requests?: boolean | null
          last_online_at?: string | null
          price_30_minutes?: number | null
          profile_completed?: boolean | null
          public_bio?: string | null
          rating_average?: number | null
          service_radius_km?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          approval_status?: string | null
          availability_status?: string | null
          cancellation_rate?: number | null
          completed_walks?: number | null
          created_at?: string | null
          experience_years?: number | null
          is_accepting_requests?: boolean | null
          last_online_at?: string | null
          price_30_minutes?: number | null
          profile_completed?: boolean | null
          public_bio?: string | null
          rating_average?: number | null
          service_radius_km?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string
          created_at: string
          id: string
          image_url: string | null
          likes_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_url?: string | null
          likes_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_url?: string | null
          likes_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_images: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          image_url: string
          product_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          image_url: string
          product_id: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          image_url?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          dimensions: string | null
          id: string
          is_active: boolean | null
          name: string
          origin_city: string | null
          petshop_id: string
          price: number
          updated_at: string
          weight: number | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          dimensions?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          origin_city?: string | null
          petshop_id: string
          price?: number
          updated_at?: string
          weight?: number | null
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          dimensions?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          origin_city?: string | null
          petshop_id?: string
          price?: number
          updated_at?: string
          weight?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age: number | null
          avatar_url: string | null
          bio: string | null
          birthday: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean | null
          phone: string | null
          role: string | null
          updated_at: string
        }
        Insert: {
          age?: number | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          onboarding_completed?: boolean | null
          phone?: string | null
          role?: string | null
          updated_at?: string
        }
        Update: {
          age?: number | null
          avatar_url?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          phone?: string | null
          role?: string | null
          updated_at?: string
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
      walk_sessions: {
        Row: {
          actual_duration_minutes: number | null
          created_at: string
          customer_id: string
          distance_km: number | null
          end_time: string | null
          feedback: string | null
          home_location: Json | null
          id: string
          local_stops: Json
          pet_id: string
          planned_duration_minutes: number
          rating: number | null
          route_coordinates: Json | null
          start_time: string
          status: string
          walk_type: string
          walker_id: string | null
          walker_name: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          created_at?: string
          customer_id: string
          distance_km?: number | null
          end_time?: string | null
          feedback?: string | null
          home_location?: Json | null
          id?: string
          local_stops?: Json
          pet_id: string
          planned_duration_minutes?: number
          rating?: number | null
          route_coordinates?: Json | null
          start_time?: string
          status?: string
          walk_type?: string
          walker_id?: string | null
          walker_name?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          created_at?: string
          customer_id?: string
          distance_km?: number | null
          end_time?: string | null
          feedback?: string | null
          home_location?: Json | null
          id?: string
          local_stops?: Json
          pet_id?: string
          planned_duration_minutes?: number
          rating?: number | null
          route_coordinates?: Json | null
          start_time?: string
          status?: string
          walk_type?: string
          walker_id?: string | null
          walker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "walk_sessions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_profiles: {
        Args: { user_ids: string[] }
        Returns: {
          avatar_url: string
          bio: string
          full_name: string
          id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user" | "petshop" | "petwalker"
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
      app_role: ["admin", "moderator", "user", "petshop", "petwalker"],
    },
  },
} as const
