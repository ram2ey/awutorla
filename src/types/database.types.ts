export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'client' | 'tailor' | 'admin';
export type OrderStatus =
  | 'pending'
  | 'cutting'
  | 'fitting'
  | 'finishing'
  | 'ready'
  | 'delivered';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

type ReadOnlyTable<T>={Row:T;Insert:{[_ in never]:never};Update:{[_ in never]:never}};
export interface Database {
  public: {
    Tables: {
      fitting_appointments:ReadOnlyTable<{id:string;order_id:string;tailor_id:string;starts_at:string;duration_minutes:number;status:string;notes:string;revision:number;last_request:Json;updated_at:string}>;
      order_rework:ReadOnlyTable<{id:string;order_id:string;reason:string;status:string;notes:string;revision:number;last_request:Json;updated_at:string}>;
      order_quality_checks:ReadOnlyTable<{id:string;order_id:string;work_revision:number;checks:Json;notes:string;checked_by:string;checked_at:string}>;
      order_audit:ReadOnlyTable<{id:string;order_id:string;event:string;details:Json;actor_id:string|null;actor_name:string;recorded_at:string}>;
      measurement_submissions:ReadOnlyTable<{id:string;actor_id:string;request:Json;result:Json;recorded_at:string}>;
      clients: {
        Row: { id: string; full_name: string; phone_number: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; full_name: string; phone_number?: string | null; created_at?: string; updated_at?: string };
        Update: { full_name?: string; phone_number?: string | null; updated_at?: string };
      };
      sms_notifications: {
        Row: { id: string; order_id: string; stage: OrderStatus; recipient: string; content: string; status: string; production_cycle:number; reviewed_by:string|null; reviewed_at:string|null; review_notes:string|null; attempts: number; provider_message_id: string | null; last_error: string | null; sent_by: string | null; sent_at: string | null; created_at: string; updated_at: string };
        Insert: { order_id: string; stage: OrderStatus; recipient: string; content: string };
        Update: { status?: string; attempts?: number; provider_message_id?: string | null; last_error?: string | null; updated_at?: string };
      };
      payments: {
        Row: { id: string; order_id: string; submission_key: string; kind: 'receipt' | 'reversal' | 'opening_balance'; amount: number; currency: 'GHS'; method: string; occurred_on: string | null; reference: string; notes: string; recorded_by: string | null; recorded_at: string; reverses_payment_id: string | null; allow_credit: boolean };
        Insert: { order_id: string; submission_key: string; kind: 'receipt' | 'reversal' | 'opening_balance'; amount: number; method: string; occurred_on?: string | null; reference?: string; notes?: string; recorded_by?: string | null; reverses_payment_id?: string | null };
        Update: { [_ in never]: never };
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          phone_number: string | null;
          avatar_url: string | null;
          role: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          phone_number?: string | null;
          avatar_url?: string | null;
          role?: UserRole;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_measurements: {
        Row: {
          id: string;
          client_id: string;
          unit: string;
          revision: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          unit?: string;
          revision?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          unit?: string;
          revision?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      measurement_parameters: {
        Row: {
          id: string;
          key: string;
          label: string;
          display_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          label: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          key?: string;
          label?: string;
          display_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      client_measurement_values: {
        Row: {
          id: string;
          client_id: string;
          parameter_id: string;
          value: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          parameter_id: string;
          value?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          parameter_id?: string;
          value?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value?: Json;
          updated_at?: string;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
        };
      };
      orders: {
        Row: {
          id: string;
          client_id: string | null;
          client_name: string;
          client_phone: string;
          status: OrderStatus;
          garment_title: string;
          garment_subtitle: string;
          fabric_type: string;
          fabric_color: string;
          fabric_notes: string;
          reference_images: string[];
          swatch_image: string | null;
          assigned_tailor: string;
          assigned_tailor_id: string | null;
          due_date: string;
          deposit_paid: number;
          total_amount: number;
          currency: string;
          notes: string | null;
          stage_history: Json;
          work_revision: number;
          production_cycle: number;
          measurement_snapshot: Json | null;
          intake_request: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          client_id?: string | null;
          client_name?: string;
          client_phone?: string;
          status?: OrderStatus;
          garment_title?: string;
          garment_subtitle?: string;
          fabric_type?: string;
          fabric_color?: string;
          fabric_notes?: string;
          reference_images?: string[];
          swatch_image?: string | null;
          assigned_tailor?: string;
          assigned_tailor_id?: string | null;
          due_date?: string;
          deposit_paid?: number;
          total_amount: number;
          currency?: string;
          notes?: string | null;
          stage_history?: Json;
          work_revision?: number;
          production_cycle?: number;
          measurement_snapshot?: Json | null;
          intake_request?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          client_name?: string;
          client_phone?: string;
          status?: OrderStatus;
          garment_title?: string;
          garment_subtitle?: string;
          fabric_type?: string;
          fabric_color?: string;
          fabric_notes?: string;
          reference_images?: string[];
          swatch_image?: string | null;
          assigned_tailor?: string;
          assigned_tailor_id?: string | null;
          due_date?: string;
          deposit_paid?: number;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          stage_history?: Json;
          work_revision?: number;
          production_cycle?: number;
          measurement_snapshot?: Json | null;
          intake_request?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      order_tasks: {
        Row: {
          id: string;
          order_id: string;
          tailor_id: string;
          tailor_name: string;
          title: string;
          task_description: string | null;
          status: TaskStatus;
          due_date: string | null;
          assigned_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          order_id: string;
          tailor_id: string;
          tailor_name?: string;
          title: string;
          task_description?: string | null;
          status?: TaskStatus;
          due_date?: string | null;
          assigned_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          tailor_id?: string;
          tailor_name?: string;
          title?: string;
          task_description?: string | null;
          status?: TaskStatus;
          due_date?: string | null;
          assigned_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      workshop_summary:{Args:Record<string,never>;Returns:Json};
      workshop_order_page:{Args:{p_view?:string;p_search?:string;p_page?:number};Returns:Json};
      workshop_receipt_page:{Args:{p_page?:number};Returns:Json};
      workshop_client_page:{Args:{p_search?:string;p_page?:number};Returns:Json};
      abandoned_sketches:{Args:Record<string,never>;Returns:Json};
      save_fitting:{Args:{p_order_id:string;p_id:string;p_expected_revision:number;p_payload:Json};Returns:Json};
      save_rework:{Args:{p_order_id:string;p_id:string;p_expected_revision:number;p_payload:Json};Returns:Json};
      record_quality_check:{Args:{p_order_id:string;p_id:string;p_expected_work_revision:number;p_checks:Json;p_notes?:string};Returns:Json};
      update_order_terms:{Args:{p_order_id:string;p_expected_updated_at:string;p_total:number;p_tailor_id:string;p_reason:string;p_allow_credit?:boolean};Returns:Json};
      reopen_order:{Args:{p_order_id:string;p_expected_stage:OrderStatus;p_reason:string};Returns:Json};
      review_sms:{Args:{p_id:string;p_expected_status:string;p_resolution:string;p_notes:string};Returns:Json};
      save_measurement_draft:{Args:{p_id:string;p_client_id:string;p_expected_revision:number;p_unit:string;p_values:Json;p_notes?:string};Returns:Json};
      advance_order_stage: { Args: { p_order_id: string; p_expected_stage: OrderStatus }; Returns: Json };
      create_bespoke_intake: { Args: { p_payload: Json }; Returns: string };
      record_manual_sms: { Args: { p_notification_id: string }; Returns: Json };
      record_payment: { Args: { p_order_id: string; p_submission_key: string; p_amount: number; p_method: string; p_occurred_on: string; p_reference?: string; p_notes?: string; p_allow_credit?: boolean }; Returns: Json };
      reverse_payment: { Args: { p_payment_id: string; p_submission_key: string; p_reason: string }; Returns: Json };
      save_client_measurements: { Args: { p_client_id: string; p_expected_revision: number; p_unit: string; p_values: Json; p_notes?: string }; Returns: Json };
      apply_order_measurements: { Args: { p_order_id: string; p_expected_capture: string | null }; Returns: Json };
    };
    Enums: {
      user_role: UserRole;
      order_status: OrderStatus;
      task_status: TaskStatus;
    };
  };
}
