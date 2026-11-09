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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
  public: {
    Tables: {
      admin_audit: {
        Row: {
          action: string
          admin_user_id: string
          at: string
          case_id: string | null
          detail: Json
          id: string
        }
        Insert: {
          action: string
          admin_user_id: string
          at?: string
          case_id?: string | null
          detail?: Json
          id?: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          at?: string
          case_id?: string | null
          detail?: Json
          id?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string | null
        }
        Relationships: []
      }
      application_confirmations: {
        Row: {
          application_id: string
          confirmed_at: string
          id: string
          kind: string
          participant_id: string
          requirement_id: string
        }
        Insert: {
          application_id: string
          confirmed_at?: string
          id?: string
          kind: string
          participant_id: string
          requirement_id: string
        }
        Update: {
          application_id?: string
          confirmed_at?: string
          id?: string
          kind?: string
          participant_id?: string
          requirement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_confirmations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_confirmations_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      application_requests: {
        Row: {
          application_id: string
          created_at: string
          detail: string | null
          fulfilled_at: string | null
          id: string
          kind: string
          requested_of: string | null
          requirement_id: string
          status: string
        }
        Insert: {
          application_id: string
          created_at?: string
          detail?: string | null
          fulfilled_at?: string | null
          id?: string
          kind: string
          requested_of?: string | null
          requirement_id: string
          status?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          detail?: string | null
          fulfilled_at?: string | null
          id?: string
          kind?: string
          requested_of?: string | null
          requirement_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          case_id: string
          catalogue_id: string | null
          created_at: string
          display_name: string | null
          id: string
          plan_id: string | null
          product: string
          resume_to: string | null
          state: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          catalogue_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          plan_id?: string | null
          product: string
          resume_to?: string | null
          state?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          catalogue_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          plan_id?: string | null
          product?: string
          resume_to?: string | null
          state?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          auth_level: string
          created_at: string
          customer_id: string | null
          id: string
          kind: string
          label: string | null
          last_seen_at: string | null
          source: string | null
          updated_at: string
        }
        Insert: {
          auth_level?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          last_seen_at?: string | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          auth_level?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          kind?: string
          label?: string | null
          last_seen_at?: string | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogue_overrides: {
        Row: {
          checkin_agendas: Json
          created_at: string
          enabled: boolean
          entry_id: string
          kind: string
          milestone_labels: Json
          name: string | null
          priority: string | null
          summary: string | null
          updated_at: string
          version: number
        }
        Insert: {
          checkin_agendas?: Json
          created_at?: string
          enabled?: boolean
          entry_id: string
          kind: string
          milestone_labels?: Json
          name?: string | null
          priority?: string | null
          summary?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          checkin_agendas?: Json
          created_at?: string
          enabled?: boolean
          entry_id?: string
          kind?: string
          milestone_labels?: Json
          name?: string | null
          priority?: string | null
          summary?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      collaborators: {
        Row: {
          consent: boolean
          created_at: string
          email: string
          id: string
          interest: string
          kind: string
          name: string
          organisation: string | null
          role: string | null
          source: string | null
        }
        Insert: {
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          interest: string
          kind?: string
          name: string
          organisation?: string | null
          role?: string | null
          source?: string | null
        }
        Update: {
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          interest?: string
          kind?: string
          name?: string
          organisation?: string | null
          role?: string | null
          source?: string | null
        }
        Relationships: []
      }
      consents: {
        Row: {
          case_id: string
          granted: boolean
          granted_at: string
          id: string
          kind: string
          participant_id: string
        }
        Insert: {
          case_id: string
          granted: boolean
          granted_at?: string
          id?: string
          kind: string
          participant_id: string
        }
        Update: {
          case_id?: string
          granted?: boolean
          granted_at?: string
          id?: string
          kind?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          bank_reference: string
          created_at: string
          date_of_birth: string
          email: string
          existing_products: string[]
          full_name: string
          id: string
          mobile: string
        }
        Insert: {
          bank_reference: string
          created_at?: string
          date_of_birth: string
          email: string
          existing_products?: string[]
          full_name: string
          id?: string
          mobile: string
        }
        Update: {
          bank_reference?: string
          created_at?: string
          date_of_birth?: string
          email?: string
          existing_products?: string[]
          full_name?: string
          id?: string
          mobile?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          application_id: string | null
          case_id: string
          document_type: string
          file_name: string | null
          id: string
          participant_id: string | null
          requirement_id: string | null
          storage_path: string
          uploaded_at: string
          verified: boolean
        }
        Insert: {
          application_id?: string | null
          case_id: string
          document_type: string
          file_name?: string | null
          id?: string
          participant_id?: string | null
          requirement_id?: string | null
          storage_path: string
          uploaded_at?: string
          verified?: boolean
        }
        Update: {
          application_id?: string | null
          case_id?: string
          document_type?: string
          file_name?: string | null
          id?: string
          participant_id?: string | null
          requirement_id?: string | null
          storage_path?: string
          uploaded_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_config: {
        Row: {
          categories: Json
          kill_switch: boolean
          scope: string
          updated_at: string
        }
        Insert: {
          categories?: Json
          kill_switch?: boolean
          scope?: string
          updated_at?: string
        }
        Update: {
          categories?: Json
          kill_switch?: boolean
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          actor: string
          application_id: string | null
          case_id: string
          created_at: string
          id: string
          payload: Json
          type: string
        }
        Insert: {
          actor: string
          application_id?: string | null
          case_id: string
          created_at?: string
          id?: string
          payload?: Json
          type: string
        }
        Update: {
          actor?: string
          application_id?: string | null
          case_id?: string
          created_at?: string
          id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      facts: {
        Row: {
          captured_at: string
          captured_for: string | null
          case_id: string
          id: string
          key: string
          participant_id: string | null
          source: string
          subject_kind: string
          superseded_by: string | null
          value: Json
          verified: boolean
        }
        Insert: {
          captured_at?: string
          captured_for?: string | null
          case_id: string
          id?: string
          key: string
          participant_id?: string | null
          source: string
          subject_kind: string
          superseded_by?: string | null
          value: Json
          verified?: boolean
        }
        Update: {
          captured_at?: string
          captured_for?: string | null
          case_id?: string
          id?: string
          key?: string
          participant_id?: string | null
          source?: string
          subject_kind?: string
          superseded_by?: string | null
          value?: Json
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "facts_captured_for_fkey"
            columns: ["captured_for"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facts_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "facts"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          case_id: string
          comment: string | null
          created_at: string
          id: string
          kind: string
          message_id: string | null
          participant_id: string | null
          rating: number
          reply_to: string | null
        }
        Insert: {
          case_id: string
          comment?: string | null
          created_at?: string
          id?: string
          kind: string
          message_id?: string | null
          participant_id?: string | null
          rating: number
          reply_to?: string | null
        }
        Update: {
          case_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          kind?: string
          message_id?: string | null
          participant_id?: string | null
          rating?: number
          reply_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_answers: {
        Row: {
          answered_at: string
          field_id: string
          form_application_id: string
          id: string
          participant_id: string | null
          source: string
          value: Json
          wording: string | null
        }
        Insert: {
          answered_at?: string
          field_id: string
          form_application_id: string
          id?: string
          participant_id?: string | null
          source: string
          value: Json
          wording?: string | null
        }
        Update: {
          answered_at?: string
          field_id?: string
          form_application_id?: string
          id?: string
          participant_id?: string | null
          source?: string
          value?: Json
          wording?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_answers_form_application_id_fkey"
            columns: ["form_application_id"]
            isOneToOne: false
            referencedRelation: "form_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_answers_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_applications: {
        Row: {
          answers: Json
          case_id: string
          created_at: string
          form_id: string
          form_version: string
          id: string
          reused_fields: string[]
          source_hash: string
          updated_at: string
        }
        Insert: {
          answers?: Json
          case_id: string
          created_at?: string
          form_id: string
          form_version: string
          id?: string
          reused_fields?: string[]
          source_hash: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          case_id?: string
          created_at?: string
          form_id?: string
          form_version?: string
          id?: string
          reused_fields?: string[]
          source_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_applications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      linked_accounts: {
        Row: {
          account_type: string
          balance: number
          bank: string
          case_id: string
          consent_expires_at: string
          consent_scope: string[]
          created_at: string
          currency: string
          display_name: string
          iban: string
          id: string
          provider: string
          revoked_at: string | null
        }
        Insert: {
          account_type: string
          balance: number
          bank: string
          case_id: string
          consent_expires_at: string
          consent_scope: string[]
          created_at?: string
          currency?: string
          display_name: string
          iban: string
          id?: string
          provider?: string
          revoked_at?: string | null
        }
        Update: {
          account_type?: string
          balance?: number
          bank?: string
          case_id?: string
          consent_expires_at?: string
          consent_scope?: string[]
          created_at?: string
          currency?: string
          display_name?: string
          iban?: string
          id?: string
          provider?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "linked_accounts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      linked_transactions: {
        Row: {
          account_id: string
          amount: number
          booked_on: string
          category: string
          description: string
          id: string
        }
        Insert: {
          account_id: string
          amount: number
          booked_on: string
          category: string
          description: string
          id?: string
        }
        Update: {
          account_id?: string
          amount?: number
          booked_on?: string
          category?: string
          description?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "linked_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "linked_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      market_products: {
        Row: {
          category: string
          checked_at: string
          conditions: Json
          effective_from: string | null
          first_seen_at: string
          id: number
          product_id: string
          provider: string
          provider_product_name: string
          rates: Json
          source_url: string
          superseded_at: string | null
          attribution: string | null
          provider_url: string | null
          source: string
          source_product_id: string | null
          source_updated_at: string | null
          unknown: string[]
        }
        Insert: {
          category: string
          checked_at: string
          conditions: Json
          effective_from?: string | null
          first_seen_at?: string
          id?: never
          product_id: string
          provider: string
          provider_product_name: string
          rates: Json
          source_url: string
          superseded_at?: string | null
          attribution?: string | null
          provider_url?: string | null
          source?: string
          source_product_id?: string | null
          source_updated_at?: string | null
          unknown?: string[]
        }
        Update: {
          category?: string
          checked_at?: string
          conditions?: Json
          effective_from?: string | null
          first_seen_at?: string
          id?: never
          product_id?: string
          provider?: string
          provider_product_name?: string
          rates?: Json
          source_url?: string
          superseded_at?: string | null
          attribution?: string | null
          provider_url?: string | null
          source?: string
          source_product_id?: string | null
          source_updated_at?: string | null
          unknown?: string[]
        }
        Relationships: []
      }
      messages: {
        Row: {
          cards: Json
          case_id: string
          content: string
          created_at: string
          gate_category: string | null
          id: string
          participant_id: string | null
          role: string
          usage: Json | null
        }
        Insert: {
          cards?: Json
          case_id: string
          content: string
          created_at?: string
          gate_category?: string | null
          id?: string
          participant_id?: string | null
          role: string
          usage?: Json | null
        }
        Update: {
          cards?: Json
          case_id?: string
          content?: string
          created_at?: string
          gate_category?: string | null
          id?: string
          participant_id?: string | null
          role?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      mortgage_rates: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          rate: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          rate: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          rate?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      need_decisions: {
        Row: {
          case_id: string
          decided_at: string
          id: string
          need_id: string
          plan_id: string | null
          reason: string | null
          revisit_on: string | null
          revisit_when: string | null
          revisited_at: string | null
          state: string
        }
        Insert: {
          case_id: string
          decided_at?: string
          id?: string
          need_id: string
          plan_id?: string | null
          reason?: string | null
          revisit_on?: string | null
          revisit_when?: string | null
          revisited_at?: string | null
          state: string
        }
        Update: {
          case_id?: string
          decided_at?: string
          id?: string
          need_id?: string
          plan_id?: string | null
          reason?: string | null
          revisit_on?: string | null
          revisit_when?: string | null
          revisited_at?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "need_decisions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "need_decisions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      participant_sessions: {
        Row: {
          auth_user_id: string
          created_at: string
          id: string
          last_used_at: string
          participant_id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          id?: string
          last_used_at?: string
          participant_id: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          id?: string
          last_used_at?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participant_sessions_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          case_id: string
          created_at: string
          display_name: string | null
          id: string
          role: string
        }
        Insert: {
          case_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          role: string
        }
        Update: {
          case_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_config: {
        Row: {
          preset: string
          scope: string
          sliders: Json
          updated_at: string
        }
        Insert: {
          preset?: string
          scope?: string
          sliders?: Json
          updated_at?: string
        }
        Update: {
          preset?: string
          scope?: string
          sliders?: Json
          updated_at?: string
        }
        Relationships: []
      }
      plan_checkins: {
        Row: {
          agenda: Json
          completed_at: string | null
          created_at: string
          due_at: string | null
          id: string
          plan_id: string
          purpose: string
          state: string
          trigger_event: string | null
          trigger_kind: string
        }
        Insert: {
          agenda?: Json
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          plan_id: string
          purpose: string
          state?: string
          trigger_event?: string | null
          trigger_kind: string
        }
        Update: {
          agenda?: Json
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          id?: string
          plan_id?: string
          purpose?: string
          state?: string
          trigger_event?: string | null
          trigger_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_checkins_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_milestones: {
        Row: {
          achieved_at: string | null
          id: string
          kind: string
          label: string
          plan_id: string
          sort: number
          state: string
          target_amount: number | null
          target_date: string | null
          target_facts: Json | null
          target_product: string | null
          target_state: string | null
        }
        Insert: {
          achieved_at?: string | null
          id?: string
          kind: string
          label: string
          plan_id: string
          sort?: number
          state?: string
          target_amount?: number | null
          target_date?: string | null
          target_facts?: Json | null
          target_product?: string | null
          target_state?: string | null
        }
        Update: {
          achieved_at?: string | null
          id?: string
          kind?: string
          label?: string
          plan_id?: string
          sort?: number
          state?: string
          target_amount?: number | null
          target_date?: string | null
          target_facts?: Json | null
          target_product?: string | null
          target_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_milestones_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_watches: {
        Row: {
          case_id: string
          created_at: string
          describe: string
          id: string
          kind: string
          met_at: string | null
          notified_at: string | null
          on_date: string | null
          target: number | null
        }
        Insert: {
          case_id: string
          created_at?: string
          describe: string
          id?: string
          kind: string
          met_at?: string | null
          notified_at?: string | null
          on_date?: string | null
          target?: number | null
        }
        Update: {
          case_id?: string
          created_at?: string
          describe?: string
          id?: string
          kind?: string
          met_at?: string | null
          notified_at?: string | null
          on_date?: string | null
          target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_watches_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          case_id: string
          completed_at: string | null
          confirmed_at: string | null
          created_at: string
          goal: string
          id: string
          last_confirmed_at: string | null
          paused_at: string | null
          status: string
          target_amount: number | null
          target_date: string | null
          title: string
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          goal: string
          id?: string
          last_confirmed_at?: string | null
          paused_at?: string | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          title: string
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          goal?: string
          id?: string
          last_confirmed_at?: string | null
          paused_at?: string | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      product_catalogue: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          product: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id: string
          product: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          product?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      product_interests: {
        Row: {
          case_id: string
          id: string
          product: string
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          case_id: string
          id?: string
          product: string
          reason?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          id?: string
          product?: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_interests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          case_id: string
          created_at: string
          endpoint: string
          expired_at: string | null
          id: string
          p256dh: string
          participant_id: string | null
        }
        Insert: {
          auth: string
          case_id: string
          created_at?: string
          endpoint: string
          expired_at?: string | null
          id?: string
          p256dh: string
          participant_id?: string | null
        }
        Update: {
          auth?: string
          case_id?: string
          created_at?: string
          endpoint?: string
          expired_at?: string | null
          id?: string
          p256dh?: string
          participant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_plans: {
        Row: {
          case_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          client: string | null
          created_at: string
          document: Json
          expires_at: string
          id: string
          title: string
          token_hash: string
          version: number
        }
        Insert: {
          case_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          client?: string | null
          created_at?: string
          document: Json
          expires_at: string
          id?: string
          title: string
          token_hash: string
          version: number
        }
        Update: {
          case_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          client?: string | null
          created_at?: string
          document?: Json
          expires_at?: string
          id?: string
          title?: string
          token_hash?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "saved_plans_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens: {
        Row: {
          case_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          participant_id: string | null
          token_hash: string
        }
        Insert: {
          case_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          participant_id?: string | null
          token_hash: string
        }
        Update: {
          case_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          participant_id?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "tokens_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tokens_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount: number
          cadence: string
          case_id: string
          created_at: string
          from_account_id: string
          id: string
          settled_at: string | null
          state: string
          to_application_id: string | null
          to_label: string
        }
        Insert: {
          amount: number
          cadence: string
          case_id: string
          created_at?: string
          from_account_id: string
          id?: string
          settled_at?: string | null
          state?: string
          to_application_id?: string | null
          to_label: string
        }
        Update: {
          amount?: number
          cadence?: string
          case_id?: string
          created_at?: string
          from_account_id?: string
          id?: string
          settled_at?: string | null
          state?: string
          to_application_id?: string | null
          to_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_account_id_fkey"
            columns: ["from_account_id"]
            isOneToOne: false
            referencedRelation: "linked_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_application_id_fkey"
            columns: ["to_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_audit_note: { Args: { p_audit: string; p_detail: Json }; Returns: undefined }
      admin_delete_case: { Args: { p_admin: string; p_case: string }; Returns: boolean }
      admin_purge_cases: { Args: { p_admin: string }; Returns: Json }
      admin_reset_case: {
        Args: {
          p_admin: string
          p_case: string
          p_customer: Json
          p_facts: Json
          p_first_name: string
          p_label: string
        }
        Returns: Json
      }
      can_read_case: { Args: { target_case_id: string }; Returns: boolean }
      invite_partner_tx: {
        Args: { p_case_id: string; p_name: string; p_token_hash: string }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      market_record_refresh: {
        Args: { p_products: Json; p_provider: string; p_retired?: string[]; p_source: string }
        Returns: Json
      }
      messages_by_day: {
        Args: { from_ts: string; to_ts: string }
        Returns: {
          count: number
          day: string
          role: string
        }[]
      }
      metrics_by_day: {
        Args: { from_ts: string; to_ts: string; types?: string[] }
        Returns: {
          count: number
          day: string
          type: string
        }[]
      }
      submit_application_tx: {
        Args: {
          p_application_id: string
          p_case_id: string
          p_confirmations: string[]
          p_events: Json
          p_from_state: string
          p_participant_id: string
          p_to_state: string
        }
        Returns: boolean
      }
      sweep_saved_plans: { Args: never; Returns: number }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
