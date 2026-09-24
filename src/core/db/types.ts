export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
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
          closes_at: string;
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
          mod_scores: Json | null;
          mod_state: string;
          rank_score: number;
          region_label: string | null;
          stance: string;
          story_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          changed_mind_count?: number;
          created_at?: string;
          cross_side_count?: number;
          evidence_url?: string | null;
          helpful_count?: number;
          id?: string;
          kind: string;
          mod_scores?: Json | null;
          mod_state?: string;
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
          mod_scores?: Json | null;
          mod_state?: string;
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
          state: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          post_id: string;
          reason: string;
          reporter_id?: string | null;
          state?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          post_id?: string;
          reason?: string;
          reporter_id?: string | null;
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
        ];
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
          voter_id: string;
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
      api_nodes: {
        Args: { p_hours: number; p_known?: string; p_limit: number };
        Returns: Json;
      };
      api_story: {
        Args: { p_article_limit?: number; p_id?: string; p_seq?: number };
        Returns: Json;
      };
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
