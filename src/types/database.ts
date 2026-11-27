// Public schema mirrored from the project migrations. See PHASE2.md for CLI generation.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
type Relation<Name extends string, Column extends string, Target extends string> = {
  foreignKeyName: Name;
  columns: ["owner_id", Column];
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: ["owner_id", "id"];
};
type Table<
  Row extends Record<string, unknown>,
  RequiredKeys extends keyof Row,
  Links extends object[] = [],
> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, RequiredKeys>;
  Update: Partial<Row>;
  Relationships: Links;
};

export type Database = {
  public: {
    Tables: {
      user_settings: Table<
        {
          owner_id: string;
          minutes_per_episode: number;
          theme: string;
          created_at: string;
          updated_at: string;
          version: number;
        },
        never
      >;
      library_entries: Table<
        {
          owner_id: string;
          id: string;
          bangumi_id: number | null;
          title_cn: string | null;
          title_original: string | null;
          cover_url: string | null;
          platform: string | null;
          meta_tags: string[];
          community_tags: string[];
          total_episodes: number | null;
          premiere_date: string | null;
          end_date: string | null;
          air_weekday: number | null;
          release_pattern: Database["public"]["Enums"]["release_pattern"];
          airing_override: Database["public"]["Enums"]["airing_state"] | null;
          calendar_seen_on: string | null;
          metadata_fetched_at: string | null;
          schedule_fetched_at: string | null;
          locked_fields: string[];
          watch_status: Database["public"]["Enums"]["watch_state"];
          watched_episodes: number;
          personal_rating: number | null;
          review: string | null;
          last_watched_at: string | null;
          created_at: string;
          updated_at: string;
          version: number;
        },
        never
      >;
      episode_schedule: Table<
        {
          owner_id: string;
          id: string;
          entry_id: string;
          bangumi_episode_id: number | null;
          sort_no: number;
          episode_no: number | null;
          title: string | null;
          air_date: string | null;
          manually_edited: boolean;
          created_at: string;
          updated_at: string;
          version: number;
        },
        "entry_id" | "sort_no",
        [Relation<"episode_schedule_owner_id_entry_id_fkey", "entry_id", "library_entries">]
      >;
      notes: Table<
        {
          owner_id: string;
          id: string;
          entry_id: string;
          body: string | null;
          episode_number: number | null;
          position_seconds: number | null;
          created_at: string;
          updated_at: string;
          version: number;
        },
        "entry_id",
        [Relation<"notes_owner_id_entry_id_fkey", "entry_id", "library_entries">]
      >;
      watch_links: Table<
        {
          owner_id: string;
          id: string;
          entry_id: string;
          label: string;
          url: string;
          created_at: string;
          updated_at: string;
          version: number;
        },
        "entry_id" | "label" | "url",
        [Relation<"watch_links_owner_id_entry_id_fkey", "entry_id", "library_entries">]
      >;
      personal_tags: Table<
        {
          owner_id: string;
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
          version: number;
        },
        "name"
      >;
      entry_tags: Table<
        {
          owner_id: string;
          entry_id: string;
          tag_id: string;
        },
        "entry_id" | "tag_id",
        [
          Relation<"entry_tags_owner_id_entry_id_fkey", "entry_id", "library_entries">,
          Relation<"entry_tags_owner_id_tag_id_fkey", "tag_id", "personal_tags">,
        ]
      >;
      sync_runs: Table<
        {
          owner_id: string;
          id: string;
          username: string;
          state: string;
          next_offset: number;
          total_hint: number | null;
          added: number;
          matched: number;
          skipped: number;
          retry_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          version: number;
        },
        "username"
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      backup_snapshot: { Args: Record<never, never>; Returns: Json };
      restore_backup: { Args: { p_changes: Json; p_revision: string }; Returns: number };
      apply_collection_page: {
        Args: {
          p_run_id: string;
          p_offset: number;
          p_count: number;
          p_total: number;
          p_rows: Json;
        };
        Returns: Json;
      };
      attach_entry_tag: { Args: { p_entry_id: string; p_name: string }; Returns: string };
      library_journal_index: { Args: Record<never, never>; Returns: Json };
      replace_episode_schedule: {
        Args: {
          p_entry_id: string;
          p_bangumi_id: number;
          p_previous_fetch?: string;
          p_episodes?: Json;
          p_calendar_weekday?: number;
        };
        Returns: boolean;
      };
      is_app_owner: { Args: Record<never, never>; Returns: boolean };
      bangumi_request_slot: {
        Args: { p_backoff_seconds?: number };
        Returns: { granted: boolean; retry_at: string }[];
      };
      increment_progress: {
        Args: { p_entry_id: string; p_request_id: string };
        Returns: {
          watched_after: number;
          total_at_action: number | null;
          version_after: number;
          advanced: boolean;
          suggest_completion: boolean;
          replayed: boolean;
        }[];
      };
    };
    Enums: {
      watch_state: "watching" | "planned" | "completed" | "on_hold" | "dropped";
      airing_state: "upcoming" | "airing" | "finished" | "unknown";
      release_pattern: "weekly" | "irregular" | "unknown";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
