export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      admins: {
        Row: {
          granted_at: string;
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          user_id: string;
        };
        Update: {
          granted_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'admins_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      articles: {
        Row: {
          headline: string;
          id: string;
          image_url: string | null;
          lang: string | null;
          outlet: string | null;
          outlet_country: string | null;
          published_at: string | null;
          snippet: string | null;
          story_id: string;
          url: string;
        };
        Insert: {
          headline: string;
          id?: string;
          image_url?: string | null;
          lang?: string | null;
          outlet?: string | null;
          outlet_country?: string | null;
          published_at?: string | null;
          snippet?: string | null;
          story_id: string;
          url: string;
        };
        Update: {
          headline?: string;
          id?: string;
          image_url?: string | null;
          lang?: string | null;
          outlet?: string | null;
          outlet_country?: string | null;
          published_at?: string | null;
          snippet?: string | null;
          story_id?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'articles_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: false;
            referencedRelation: 'stories';
            referencedColumns: ['id'];
          },
        ];
      };
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id?: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocks_blocked_id_fkey';
            columns: ['blocked_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'blocks_blocker_id_fkey';
            columns: ['blocker_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      discussion_stances: {
        Row: {
          chosen_at: string;
          locked_at: string | null;
          stance: string;
          story_id: string;
          user_id: string;
        };
        Insert: {
          chosen_at?: string;
          locked_at?: string | null;
          stance: string;
          story_id: string;
          user_id?: string;
        };
        Update: {
          chosen_at?: string;
          locked_at?: string | null;
          stance?: string;
          story_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'discussion_stances_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: false;
            referencedRelation: 'discussions';
            referencedColumns: ['story_id'];
          },
          {
            foreignKeyName: 'discussion_stances_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      discussions: {
        Row: {
          closes_at: string;
          opened_at: string;
          post_count: number;
          prompt: string;
          side_a_label: string;
          side_b_label: string;
          state: string;
          story_id: string;
        };
        Insert: {
          closes_at?: string;
          opened_at?: string;
          post_count?: number;
          prompt: string;
          side_a_label: string;
          side_b_label: string;
          state?: string;
          story_id: string;
        };
        Update: {
          closes_at?: string;
          opened_at?: string;
          post_count?: number;
          prompt?: string;
          side_a_label?: string;
          side_b_label?: string;
          state?: string;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'discussions_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: true;
            referencedRelation: 'stories';
            referencedColumns: ['id'];
          },
        ];
      };
      feature_flags: {
        Row: {
          description: string | null;
          enabled: boolean;
          key: string;
          updated_at: string;
          value: Json | null;
        };
        Insert: {
          description?: string | null;
          enabled?: boolean;
          key: string;
          updated_at?: string;
          value?: Json | null;
        };
        Update: {
          description?: string | null;
          enabled?: boolean;
          key?: string;
          updated_at?: string;
          value?: Json | null;
        };
        Relationships: [];
      };
      follows: {
        Row: {
          baseline: number | null;
          created_at: string;
          kind: string;
          label: string;
          target: string;
          user_id: string;
        };
        Insert: {
          baseline?: number | null;
          created_at?: string;
          kind: string;
          label: string;
          target: string;
          user_id?: string;
        };
        Update: {
          baseline?: number | null;
          created_at?: string;
          kind?: string;
          label?: string;
          target?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ingest_runs: {
        Row: {
          attempts: number;
          counts: Json | null;
          error: string | null;
          finished_at: string | null;
          slot: string;
          started_at: string;
          status: string;
        };
        Insert: {
          attempts?: number;
          counts?: Json | null;
          error?: string | null;
          finished_at?: string | null;
          slot: string;
          started_at?: string;
          status: string;
        };
        Update: {
          attempts?: number;
          counts?: Json | null;
          error?: string | null;
          finished_at?: string | null;
          slot?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      moderation_actions: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: number;
          post_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          post_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          post_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'moderation_actions_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'moderation_actions_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          detail: Json;
          id: string;
          kind: string;
          post_id: string | null;
          read_at: string | null;
          story_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          detail?: Json;
          id?: string;
          kind: string;
          post_id?: string | null;
          read_at?: string | null;
          story_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          detail?: Json;
          id?: string;
          kind?: string;
          post_id?: string | null;
          read_at?: string | null;
          story_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: false;
            referencedRelation: 'discussions';
            referencedColumns: ['story_id'];
          },
          {
            foreignKeyName: 'notifications_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      posts: {
        Row: {
          author_id: string;
          body: string;
          changed_mind_count: number;
          created_at: string;
          cross_side_count: number;
          evidence_url: string | null;
          helpful_count: number;
          id: string;
          kind: string;
          mod_attempts: number;
          mod_requested_at: string | null;
          mod_scores: Json | null;
          mod_state: string;
          moderated_at: string | null;
          rank_score: number;
          region_label: string | null;
          stance: string;
          story_id: string;
        };
        Insert: {
          author_id?: string;
          body: string;
          changed_mind_count?: number;
          created_at?: string;
          cross_side_count?: number;
          evidence_url?: string | null;
          helpful_count?: number;
          id?: string;
          kind: string;
          mod_attempts?: number;
          mod_requested_at?: string | null;
          mod_scores?: Json | null;
          mod_state?: string;
          moderated_at?: string | null;
          rank_score?: number;
          region_label?: string | null;
          stance: string;
          story_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          changed_mind_count?: number;
          created_at?: string;
          cross_side_count?: number;
          evidence_url?: string | null;
          helpful_count?: number;
          id?: string;
          kind?: string;
          mod_attempts?: number;
          mod_requested_at?: string | null;
          mod_scores?: Json | null;
          mod_state?: string;
          moderated_at?: string | null;
          rank_score?: number;
          region_label?: string | null;
          stance?: string;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'posts_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'posts_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: false;
            referencedRelation: 'discussions';
            referencedColumns: ['story_id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          handle: string;
          id: string;
          is_adult: boolean;
          rules_accepted_at: string | null;
          strikes: number;
          suspended_at: string | null;
          tier: string;
          trust_level: number;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          handle: string;
          id: string;
          is_adult?: boolean;
          rules_accepted_at?: string | null;
          strikes?: number;
          suspended_at?: string | null;
          tier?: string;
          trust_level?: number;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          handle?: string;
          id?: string;
          is_adult?: boolean;
          rules_accepted_at?: string | null;
          strikes?: number;
          suspended_at?: string | null;
          tier?: string;
          trust_level?: number;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          id: string;
          post_id: string;
          reason: string;
          reporter_id: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          state: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          post_id: string;
          reason: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          state?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          post_id?: string;
          reason?: string;
          reporter_id?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reports_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saved_stories: {
        Row: {
          headline: string;
          place: string;
          published_at: string;
          saved_at: string;
          story_seq: number;
          user_id: string;
        };
        Insert: {
          headline: string;
          place?: string;
          published_at: string;
          saved_at?: string;
          story_seq: number;
          user_id?: string;
        };
        Update: {
          headline?: string;
          place?: string;
          published_at?: string;
          saved_at?: string;
          story_seq?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      stories: {
        Row: {
          category: number;
          country_code: string | null;
          discussion_state: string;
          first_seen_at: string;
          geog: unknown;
          heat: number;
          id: string;
          lat: number;
          lon: number;
          place_conf: number | null;
          place_name: string | null;
          place_source: string | null;
          published_at: string;
          sentiment: number;
          seq: number;
          source_count: number;
          summary: string | null;
          title: string;
          title_hash: number | null;
        };
        Insert: {
          category: number;
          country_code?: string | null;
          discussion_state?: string;
          first_seen_at?: string;
          geog?: unknown;
          heat?: number;
          id?: string;
          lat: number;
          lon: number;
          place_conf?: number | null;
          place_name?: string | null;
          place_source?: string | null;
          published_at: string;
          sentiment?: number;
          seq?: never;
          source_count?: number;
          summary?: string | null;
          title: string;
          title_hash?: number | null;
        };
        Update: {
          category?: number;
          country_code?: string | null;
          discussion_state?: string;
          first_seen_at?: string;
          geog?: unknown;
          heat?: number;
          id?: string;
          lat?: number;
          lon?: number;
          place_conf?: number | null;
          place_name?: string | null;
          place_source?: string | null;
          published_at?: string;
          sentiment?: number;
          seq?: never;
          source_count?: number;
          summary?: string | null;
          title?: string;
          title_hash?: number | null;
        };
        Relationships: [];
      };
      story_location_reports: {
        Row: {
          first_reported_at: string;
          last_reported_at: string;
          reports: number;
          story_id: string;
        };
        Insert: {
          first_reported_at?: string;
          last_reported_at?: string;
          reports?: number;
          story_id: string;
        };
        Update: {
          first_reported_at?: string;
          last_reported_at?: string;
          reports?: number;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'story_location_reports_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: true;
            referencedRelation: 'stories';
            referencedColumns: ['id'];
          },
        ];
      };
      story_signals: {
        Row: {
          keys: string[];
          last_seen_at: string;
          state: Json;
          story_id: string;
        };
        Insert: {
          keys?: string[];
          last_seen_at: string;
          state: Json;
          story_id: string;
        };
        Update: {
          keys?: string[];
          last_seen_at?: string;
          state?: Json;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'story_signals_story_id_fkey';
            columns: ['story_id'];
            isOneToOne: true;
            referencedRelation: 'stories';
            referencedColumns: ['id'];
          },
        ];
      };
      strikes: {
        Row: {
          created_at: string;
          id: string;
          issued_by: string | null;
          post_id: string | null;
          source: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          issued_by?: string | null;
          post_id?: string | null;
          source: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          issued_by?: string | null;
          post_id?: string | null;
          source?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'strikes_issued_by_fkey';
            columns: ['issued_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'strikes_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: true;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'strikes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      votes: {
        Row: {
          created_at: string;
          kind: string;
          post_id: string;
          voter_id: string;
          voter_stance: string | null;
        };
        Insert: {
          created_at?: string;
          kind: string;
          post_id: string;
          voter_id?: string;
          voter_stance?: string | null;
        };
        Update: {
          created_at?: string;
          kind?: string;
          post_id?: string;
          voter_id?: string;
          voter_stance?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'votes_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'votes_voter_id_fkey';
            columns: ['voter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_rules: { Args: never; Returns: string };
      api_nodes: {
        Args: { p_hours: number; p_known?: string; p_limit: number };
        Returns: Json;
      };
      api_outlet_stories: {
        Args: { p_hours: number; p_limit: number; p_outlet: string };
        Returns: Json;
      };
      api_outlets: {
        Args: { p_hours: number; p_known?: string; p_limit: number };
        Returns: Json;
      };
      api_report_location: {
        Args: { p_id?: string; p_seq?: number };
        Returns: boolean;
      };
      api_story: {
        Args: { p_article_limit?: number; p_id?: string; p_seq?: number };
        Returns: Json;
      };
      api_window: {
        Args: { p_hours: number; p_limit: number };
        Returns: {
          published_at: string;
          seq: number;
          story_id: string;
          window_end: string;
        }[];
      };
      claim_handle: {
        Args: { p_handle: string; p_is_adult: boolean };
        Returns: string;
      };
      delete_my_account: { Args: never; Returns: undefined };
      discussion_participants: { Args: { p_story: string }; Returns: number };
      handle_reserved: { Args: { p_handle: string }; Returns: boolean };
      handles_available: { Args: { p_handles: string[] }; Returns: string[] };
      ingest_apply: { Args: { p_batch: Json }; Returns: Json };
      ingest_candidates: {
        Args: { p_clusters: Json; p_min_overlap?: number; p_since: string };
        Returns: {
          cluster: number;
          discussion_state: string;
          first_seen_at: string;
          heat: number;
          keys: string[];
          overlap: number;
          published_at: string;
          state: Json;
          story_id: string;
        }[];
      };
      ingest_claim: {
        Args: { p_slot: string; p_stale?: string };
        Returns: boolean;
      };
      ingest_finish: {
        Args: {
          p_counts?: Json;
          p_error?: string;
          p_slot: string;
          p_status: string;
        };
        Returns: string;
      };
      ingest_known_urls: { Args: { p_urls: string[] }; Returns: string[] };
      ingest_prune: {
        Args: {
          p_run_cutoff: string;
          p_signal_cutoff?: string;
          p_story_cutoff: string;
        };
        Returns: Json;
      };
      moderate_post: {
        Args: { p_action: string; p_post: string };
        Returns: string;
      };
      moderation_queue: {
        Args: { p_limit?: number };
        Returns: {
          author_handle: string;
          author_id: string;
          author_strikes: number;
          author_suspended: boolean;
          body: string;
          created_at: string;
          evidence_url: string;
          flagged: string[];
          kind: string;
          mod_scores: Json;
          mod_state: string;
          post_id: string;
          prompt: string;
          queued_for: string;
          report_count: number;
          report_reasons: Json;
          side_label: string;
          stance: string;
          story_id: string;
          strikes_to_suspend: number;
          toxicity: number;
          waiting_since: string;
        }[];
      };
      my_profile: {
        Args: never;
        Returns: {
          created_at: string;
          display_name: string;
          handle: string;
          is_admin: boolean;
          is_adult: boolean;
          rules_accepted_at: string;
          strikes: number;
          suspended_at: string;
          tier: string;
        }[];
      };
      record_moderation: {
        Args: { p_post: string; p_scores: Json };
        Returns: string;
      };
      report_post: {
        Args: { p_post: string; p_reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
