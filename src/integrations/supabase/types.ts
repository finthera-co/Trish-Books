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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      account_categories: {
        Row: {
          account_type: string
          created_at: string
          id: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          account_type: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          account_type?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_settings: {
        Row: {
          ap_account_id: string | null
          ar_account_id: string | null
          bank_account_id: string | null
          created_at: string
          id: string
          inventory_adjustment_approval_threshold: number
          sales_account_id: string | null
          tax_payable_account_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ap_account_id?: string | null
          ar_account_id?: string | null
          bank_account_id?: string | null
          created_at?: string
          id?: string
          inventory_adjustment_approval_threshold?: number
          sales_account_id?: string | null
          tax_payable_account_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ap_account_id?: string | null
          ar_account_id?: string | null
          bank_account_id?: string | null
          created_at?: string
          id?: string
          inventory_adjustment_approval_threshold?: number
          sales_account_id?: string | null
          tax_payable_account_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_settings_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_sales_account_id_fkey"
            columns: ["sales_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_tax_payable_account_id_fkey"
            columns: ["tax_payable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_types: {
        Row: {
          id: string
          type_name: string
        }
        Insert: {
          id?: string
          type_name: string
        }
        Update: {
          id?: string
          type_name?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          account_code: string
          account_name: string
          account_subtype: string | null
          account_type: string
          category_id: string | null
          created_at: string
          created_from: string | null
          id: string
          is_active: boolean
          is_contra: boolean
          is_control_account: boolean
          is_locked: boolean
          is_system: boolean
          normal_balance: string
          opening_balance: number
          opening_balance_enabled: boolean
          opening_balance_type: string
          parent_account_id: string | null
          requires_subledger: boolean
          subledger_type: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_code: string
          account_name: string
          account_subtype?: string | null
          account_type: string
          category_id?: string | null
          created_at?: string
          created_from?: string | null
          id?: string
          is_active?: boolean
          is_contra?: boolean
          is_control_account?: boolean
          is_locked?: boolean
          is_system?: boolean
          normal_balance?: string
          opening_balance?: number
          opening_balance_enabled?: boolean
          opening_balance_type?: string
          parent_account_id?: string | null
          requires_subledger?: boolean
          subledger_type?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_code?: string
          account_name?: string
          account_subtype?: string | null
          account_type?: string
          category_id?: string | null
          created_at?: string
          created_from?: string | null
          id?: string
          is_active?: boolean
          is_contra?: boolean
          is_control_account?: boolean
          is_locked?: boolean
          is_system?: boolean
          normal_balance?: string
          opening_balance?: number
          opening_balance_enabled?: boolean
          opening_balance_type?: string
          parent_account_id?: string | null
          requires_subledger?: boolean
          subledger_type?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "account_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      anomalies: {
        Row: {
          created_at: string
          id: string
          reason: string
          score: number
          status: string
          tenant_id: string
          transaction_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          score?: number
          status?: string
          tenant_id: string
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          score?: number
          status?: string
          tenant_id?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anomalies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anomalies_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_subledger: {
        Row: {
          amount: number
          balance: number
          bill_no: string | null
          created_at: string
          credit: number
          debit: number
          document_id: string | null
          document_type: string | null
          due_date: string | null
          id: string
          journal_id: string | null
          journal_line_id: string
          tenant_id: string
          vendor_id: string
        }
        Insert: {
          amount?: number
          balance?: number
          bill_no?: string | null
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          journal_id?: string | null
          journal_line_id: string
          tenant_id: string
          vendor_id: string
        }
        Update: {
          amount?: number
          balance?: number
          bill_no?: string | null
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          journal_id?: string | null
          journal_line_id?: string
          tenant_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_subledger_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_subledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_subledger_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_credit_notes: {
        Row: {
          amount: number
          ar_account_id: string | null
          created_at: string
          credit_date: string
          credit_note_number: string
          customer_id: string
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          reason: string | null
          revenue_account_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          ar_account_id?: string | null
          created_at?: string
          credit_date?: string
          credit_note_number: string
          customer_id: string
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          reason?: string | null
          revenue_account_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          ar_account_id?: string | null
          created_at?: string
          credit_date?: string
          credit_note_number?: string
          customer_id?: string
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          reason?: string | null
          revenue_account_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_credit_notes_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_subledger: {
        Row: {
          amount: number
          balance: number
          created_at: string
          credit: number
          customer_id: string
          debit: number
          document_id: string | null
          document_type: string | null
          due_date: string | null
          id: string
          invoice_no: string | null
          journal_id: string | null
          journal_line_id: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          balance?: number
          created_at?: string
          credit?: number
          customer_id: string
          debit?: number
          document_id?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          journal_id?: string | null
          journal_line_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          balance?: number
          created_at?: string
          credit?: number
          customer_id?: string
          debit?: number
          document_id?: string | null
          document_type?: string | null
          due_date?: string | null
          id?: string
          invoice_no?: string | null
          journal_id?: string | null
          journal_line_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_subledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_subledger_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_subledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_categories: {
        Row: {
          accumulated_depreciation_account_id: string | null
          asset_account_id: string | null
          created_at: string
          default_useful_life_months: number
          depreciation_expense_account_id: string | null
          depreciation_method: string
          disposal_gain_account_id: string | null
          disposal_loss_account_id: string | null
          id: string
          is_active: boolean
          name: string
          proration_method: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accumulated_depreciation_account_id?: string | null
          asset_account_id?: string | null
          created_at?: string
          default_useful_life_months?: number
          depreciation_expense_account_id?: string | null
          depreciation_method?: string
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          proration_method?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accumulated_depreciation_account_id?: string | null
          asset_account_id?: string | null
          created_at?: string
          default_useful_life_months?: number
          depreciation_expense_account_id?: string | null
          depreciation_method?: string
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          proration_method?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_categories_accumulated_depreciation_account_id_fkey"
            columns: ["accumulated_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_depreciation_expense_account_id_fkey"
            columns: ["depreciation_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_disposal_gain_account_id_fkey"
            columns: ["disposal_gain_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_disposal_loss_account_id_fkey"
            columns: ["disposal_loss_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_depreciation: {
        Row: {
          accumulated_depreciation: number
          asset_id: string
          created_at: string
          depreciation_amount: number
          id: string
          journal_entry_id: string | null
          net_book_value: number
          period: string
          status: string
          tenant_id: string
        }
        Insert: {
          accumulated_depreciation?: number
          asset_id: string
          created_at?: string
          depreciation_amount?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value?: number
          period: string
          status?: string
          tenant_id: string
        }
        Update: {
          accumulated_depreciation?: number
          asset_id?: string
          created_at?: string
          depreciation_amount?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value?: number
          period?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_depreciation_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_disposals: {
        Row: {
          asset_id: string
          created_at: string
          disposal_date: string
          gain_loss: number
          id: string
          journal_entry_id: string | null
          sale_value: number
          tenant_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          disposal_date?: string
          gain_loss?: number
          id?: string
          journal_entry_id?: string | null
          sale_value?: number
          tenant_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          disposal_date?: string
          gain_loss?: number
          id?: string
          journal_entry_id?: string | null
          sale_value?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_disposals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_disposals_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_disposals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_subledger: {
        Row: {
          amount: number
          asset_id: string
          balance: number
          cost: number
          created_at: string
          credit: number
          debit: number
          document_id: string | null
          document_type: string | null
          id: string
          journal_id: string | null
          journal_line_id: string
          life_years: number | null
          salvage: number
          tenant_id: string
          transaction_type: string | null
        }
        Insert: {
          amount?: number
          asset_id: string
          balance?: number
          cost?: number
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          id?: string
          journal_id?: string | null
          journal_line_id: string
          life_years?: number | null
          salvage?: number
          tenant_id: string
          transaction_type?: string | null
        }
        Update: {
          amount?: number
          asset_id?: string
          balance?: number
          cost?: number
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          id?: string
          journal_id?: string | null
          journal_line_id?: string
          life_years?: number | null
          salvage?: number
          tenant_id?: string
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_subledger_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_subledger_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_subledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          record_id: string | null
          table_name: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          record_id?: string | null
          table_name?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          record_id?: string | null
          table_name?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_feed_transactions: {
        Row: {
          amount: number
          bank_account_id: string
          bank_balance: number | null
          created_at: string
          description: string | null
          duplicate_of: string | null
          id: string
          import_batch: string | null
          is_duplicate: boolean
          match_confidence: number | null
          match_metadata: Json | null
          match_type: string | null
          matched_journal_line_id: string | null
          reconciliation_id: string | null
          reference_number: string | null
          state: string
          status: string
          tenant_id: string
          transaction_date: string
        }
        Insert: {
          amount?: number
          bank_account_id: string
          bank_balance?: number | null
          created_at?: string
          description?: string | null
          duplicate_of?: string | null
          id?: string
          import_batch?: string | null
          is_duplicate?: boolean
          match_confidence?: number | null
          match_metadata?: Json | null
          match_type?: string | null
          matched_journal_line_id?: string | null
          reconciliation_id?: string | null
          reference_number?: string | null
          state?: string
          status?: string
          tenant_id: string
          transaction_date: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          bank_balance?: number | null
          created_at?: string
          description?: string | null
          duplicate_of?: string | null
          id?: string
          import_batch?: string | null
          is_duplicate?: boolean
          match_confidence?: number | null
          match_metadata?: Json | null
          match_type?: string | null
          matched_journal_line_id?: string | null
          reconciliation_id?: string | null
          reference_number?: string | null
          state?: string
          status?: string
          tenant_id?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_feed_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_feed_transactions_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "bank_feed_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_feed_transactions_matched_journal_line_id_fkey"
            columns: ["matched_journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_feed_transactions_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_feed_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          bank_account_id: string
          beginning_balance: number
          cleared_balance: number
          created_at: string
          difference: number
          id: string
          interest_earned: number | null
          locked_at: string | null
          locked_by: string | null
          notes: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          service_charges: number | null
          statement_ending_balance: number
          statement_ending_date: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bank_account_id: string
          beginning_balance?: number
          cleared_balance?: number
          created_at?: string
          difference?: number
          id?: string
          interest_earned?: number | null
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          service_charges?: number | null
          statement_ending_balance?: number
          statement_ending_date: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bank_account_id?: string
          beginning_balance?: number
          cleared_balance?: number
          created_at?: string
          difference?: number
          id?: string
          interest_earned?: number | null
          locked_at?: string | null
          locked_by?: string | null
          notes?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          service_charges?: number | null
          statement_ending_balance?: number
          statement_ending_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliations_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliations_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_reconciliations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_consumptions: {
        Row: {
          account_id: string
          class_id: string | null
          consumed_amount: number
          department_id: string | null
          id: string
          period: string
          project_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          class_id?: string | null
          consumed_amount?: number
          department_id?: string | null
          id?: string
          period: string
          project_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          class_id?: string | null
          consumed_amount?: number
          department_id?: string | null
          id?: string
          period?: string
          project_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_consumptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_controls: {
        Row: {
          apply_to_accounts: string
          created_at: string
          dimension_strict_mode: boolean
          enforcement_mode: string
          missing_budget_behavior: string
          tenant_id: string
          tolerance_percentage: number
          updated_at: string
        }
        Insert: {
          apply_to_accounts?: string
          created_at?: string
          dimension_strict_mode?: boolean
          enforcement_mode?: string
          missing_budget_behavior?: string
          tenant_id: string
          tolerance_percentage?: number
          updated_at?: string
        }
        Update: {
          apply_to_accounts?: string
          created_at?: string
          dimension_strict_mode?: boolean
          enforcement_mode?: string
          missing_budget_behavior?: string
          tenant_id?: string
          tolerance_percentage?: number
          updated_at?: string
        }
        Relationships: []
      }
      budget_items: {
        Row: {
          account_id: string
          allocated_amount: number
          budget_id: string
          class_id: string | null
          department_id: string | null
          id: string
          period: string | null
          period_type: string
          project_id: string | null
          tenant_id: string
          warning_threshold: number
        }
        Insert: {
          account_id: string
          allocated_amount?: number
          budget_id: string
          class_id?: string | null
          department_id?: string | null
          id?: string
          period?: string | null
          period_type?: string
          project_id?: string | null
          tenant_id: string
          warning_threshold?: number
        }
        Update: {
          account_id?: string
          allocated_amount?: number
          budget_id?: string
          class_id?: string | null
          department_id?: string | null
          id?: string
          period?: string | null
          period_type?: string
          project_id?: string | null
          tenant_id?: string
          warning_threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_items_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_transactions: {
        Row: {
          amount: number
          budget_line_id: string
          created_at: string
          id: string
          reference_id: string
          reference_type: string
          tenant_id: string
          transaction_date: string
        }
        Insert: {
          amount?: number
          budget_line_id: string
          created_at?: string
          id?: string
          reference_id: string
          reference_type: string
          tenant_id: string
          transaction_date?: string
        }
        Update: {
          amount?: number
          budget_line_id?: string
          created_at?: string
          id?: string
          reference_id?: string
          reference_type?: string
          tenant_id?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_transactions_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_variances: {
        Row: {
          actual_amount: number
          budget_item_id: string
          calculated_at: string
          id: string
          variance: number
        }
        Insert: {
          actual_amount?: number
          budget_item_id: string
          calculated_at?: string
          id?: string
          variance?: number
        }
        Update: {
          actual_amount?: number
          budget_item_id?: string
          calculated_at?: string
          id?: string
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_variances_budget_item_id_fkey"
            columns: ["budget_item_id"]
            isOneToOne: false
            referencedRelation: "budget_items"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          created_at: string
          department: string
          id: string
          name: string | null
          period_end: string
          period_start: string
          period_type: string
          status: string
          tenant_id: string
          total_budget: number
          version: number
        }
        Insert: {
          created_at?: string
          department: string
          id?: string
          name?: string | null
          period_end: string
          period_start: string
          period_type?: string
          status?: string
          tenant_id: string
          total_budget?: number
          version?: number
        }
        Update: {
          created_at?: string
          department?: string
          id?: string
          name?: string | null
          period_end?: string
          period_start?: string
          period_type?: string
          status?: string
          tenant_id?: string
          total_budget?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_line1: string | null
          city: string | null
          country: string | null
          customer_id: string
          id: string
          postal_code: string | null
        }
        Insert: {
          address_line1?: string | null
          city?: string | null
          country?: string | null
          customer_id: string
          id?: string
          postal_code?: string | null
        }
        Update: {
          address_line1?: string | null
          city?: string | null
          country?: string | null
          customer_id?: string
          id?: string
          postal_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          credit_limit: number
          email: string | null
          id: string
          name: string
          opening_balance: number
          payment_terms: string
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          email?: string | null
          id?: string
          name: string
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          credit_limit?: number
          email?: string | null
          id?: string
          name?: string
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_balances: {
        Row: {
          closing_balance: number
          created_at: string
          date: string
          id: string
          tenant_id: string
        }
        Insert: {
          closing_balance?: number
          created_at?: string
          date: string
          id?: string
          tenant_id: string
        }
        Update: {
          closing_balance?: number
          created_at?: string
          date?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_kpi_preferences: {
        Row: {
          created_at: string
          id: string
          pinned_kpis: string[]
          updated_at: string
          user_id: string
          visible_kpis: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          pinned_kpis?: string[]
          updated_at?: string
          user_id: string
          visible_kpis?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          pinned_kpis?: string[]
          updated_at?: string
          user_id?: string
          visible_kpis?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_kpi_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_note_lines: {
        Row: {
          created_at: string
          dn_id: string
          id: string
          invoice_item_id: string | null
          item_id: string
          line_cost: number
          qty: number
          tenant_id: string
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          dn_id: string
          id?: string
          invoice_item_id?: string | null
          item_id: string
          line_cost?: number
          qty: number
          tenant_id: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          dn_id?: string
          id?: string
          invoice_item_id?: string | null
          item_id?: string
          line_cost?: number
          qty?: number
          tenant_id?: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_note_lines_dn_id_fkey"
            columns: ["dn_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          dispatch_date: string
          dn_number: string
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          notes: string | null
          posted_at: string | null
          status: string
          tenant_id: string
          total_cogs: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dispatch_date?: string
          dn_number: string
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          tenant_id: string
          total_cogs?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          dispatch_date?: string
          dn_number?: string
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          tenant_id?: string
          total_cogs?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          created_at: string
          department: string | null
          email: string | null
          employment_type: string
          epf_number: string | null
          first_name: string
          hire_date: string | null
          id: string
          is_epf_applicable: boolean
          is_etf_applicable: boolean
          is_paye_applicable: boolean
          last_name: string
          leave_balance: number
          nic_number: string | null
          pay_rate: number | null
          pay_rate_type: string
          pay_schedule_id: string | null
          salary: number | null
          sick_balance: number
          status: string
          tenant_id: string
          vacation_balance: number
        }
        Insert: {
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employment_type?: string
          epf_number?: string | null
          first_name: string
          hire_date?: string | null
          id?: string
          is_epf_applicable?: boolean
          is_etf_applicable?: boolean
          is_paye_applicable?: boolean
          last_name: string
          leave_balance?: number
          nic_number?: string | null
          pay_rate?: number | null
          pay_rate_type?: string
          pay_schedule_id?: string | null
          salary?: number | null
          sick_balance?: number
          status?: string
          tenant_id: string
          vacation_balance?: number
        }
        Update: {
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          employment_type?: string
          epf_number?: string | null
          first_name?: string
          hire_date?: string | null
          id?: string
          is_epf_applicable?: boolean
          is_etf_applicable?: boolean
          is_paye_applicable?: boolean
          last_name?: string
          leave_balance?: number
          nic_number?: string | null
          pay_rate?: number | null
          pay_rate_type?: string
          pay_schedule_id?: string | null
          salary?: number | null
          sick_balance?: number
          status?: string
          tenant_id?: string
          vacation_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_pay_schedule_id_fkey"
            columns: ["pay_schedule_id"]
            isOneToOne: false
            referencedRelation: "pay_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          account_id: string | null
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          account_id?: string | null
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          account_id?: string | null
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          description: string | null
          employee_id: string | null
          expense_date: string
          id: string
          receipt_url: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          employee_id?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          employee_id?: string | null
          expense_date?: string
          id?: string
          receipt_url?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      export_logs: {
        Row: {
          created_at: string
          export_type: string
          file_name: string
          file_path: string
          id: string
          tables_included: string[]
          tenant_id: string
        }
        Insert: {
          created_at?: string
          export_type?: string
          file_name: string
          file_path: string
          id?: string
          tables_included?: string[]
          tenant_id: string
        }
        Update: {
          created_at?: string
          export_type?: string
          file_name?: string
          file_path?: string
          id?: string
          tables_included?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_forecasts: {
        Row: {
          category_id: string | null
          category_name: string
          created_at: string
          data_points_used: number
          data_quality_score: number
          fallback_used: boolean
          forecast_run_id: string | null
          forecast_value: number
          granularity: string
          id: string
          lower_bound: number
          metadata: Json | null
          model_type: string
          period: string
          residual_std_dev: number
          stream: string
          tenant_id: string
          upper_bound: number
        }
        Insert: {
          category_id?: string | null
          category_name: string
          created_at?: string
          data_points_used?: number
          data_quality_score?: number
          fallback_used?: boolean
          forecast_run_id?: string | null
          forecast_value?: number
          granularity?: string
          id?: string
          lower_bound?: number
          metadata?: Json | null
          model_type?: string
          period: string
          residual_std_dev?: number
          stream?: string
          tenant_id: string
          upper_bound?: number
        }
        Update: {
          category_id?: string | null
          category_name?: string
          created_at?: string
          data_points_used?: number
          data_quality_score?: number
          fallback_used?: boolean
          forecast_run_id?: string | null
          forecast_value?: number
          granularity?: string
          id?: string
          lower_bound?: number
          metadata?: Json | null
          model_type?: string
          period?: string
          residual_std_dev?: number
          stream?: string
          tenant_id?: string
          upper_bound?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_forecasts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "account_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_forecasts_forecast_run_id_fkey"
            columns: ["forecast_run_id"]
            isOneToOne: false
            referencedRelation: "forecast_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_forecasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reports: {
        Row: {
          file_url: string | null
          generated_at: string
          id: string
          report_type: string
          tenant_id: string
        }
        Insert: {
          file_url?: string | null
          generated_at?: string
          id?: string
          report_type: string
          tenant_id: string
        }
        Update: {
          file_url?: string | null
          generated_at?: string
          id?: string
          report_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          name: string
          period_end: string
          period_start: string
          status: string
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          name: string
          period_end: string
          period_start: string
          status?: string
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          name?: string
          period_end?: string
          period_start?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accumulated_depreciation: number
          acquisition_date: string | null
          asset_account_id: string | null
          asset_name: string
          category_id: string | null
          cost: number
          created_at: string
          depr_expense_account_id: string | null
          depreciation_account_id: string | null
          depreciation_method: string
          description: string | null
          id: string
          salvage_value: number
          start_date: string | null
          status: string
          tenant_id: string
          updated_at: string
          useful_life_months: number
        }
        Insert: {
          accumulated_depreciation?: number
          acquisition_date?: string | null
          asset_account_id?: string | null
          asset_name: string
          category_id?: string | null
          cost?: number
          created_at?: string
          depr_expense_account_id?: string | null
          depreciation_account_id?: string | null
          depreciation_method?: string
          description?: string | null
          id?: string
          salvage_value?: number
          start_date?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          useful_life_months?: number
        }
        Update: {
          accumulated_depreciation?: number
          acquisition_date?: string | null
          asset_account_id?: string | null
          asset_name?: string
          category_id?: string | null
          cost?: number
          created_at?: string
          depr_expense_account_id?: string | null
          depreciation_account_id?: string | null
          depreciation_method?: string
          description?: string | null
          id?: string
          salvage_value?: number
          start_date?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          useful_life_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depr_expense_account_id_fkey"
            columns: ["depr_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_depreciation_account_id_fkey"
            columns: ["depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_accuracy: {
        Row: {
          category_name: string
          created_at: string
          data_points: number
          evaluated_period: string
          forecast_run_id: string
          id: string
          mape: number
          rmse: number
          stream: string
          tenant_id: string
        }
        Insert: {
          category_name: string
          created_at?: string
          data_points?: number
          evaluated_period: string
          forecast_run_id: string
          id?: string
          mape?: number
          rmse?: number
          stream: string
          tenant_id: string
        }
        Update: {
          category_name?: string
          created_at?: string
          data_points?: number
          evaluated_period?: string
          forecast_run_id?: string
          id?: string
          mape?: number
          rmse?: number
          stream?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_accuracy_forecast_run_id_fkey"
            columns: ["forecast_run_id"]
            isOneToOne: false
            referencedRelation: "forecast_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_accuracy_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_jobs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          forecast_rows_inserted: number
          id: string
          logs: Json | null
          run_time: string
          status: string
          tenants_processed: number
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          forecast_rows_inserted?: number
          id?: string
          logs?: Json | null
          run_time?: string
          status?: string
          tenants_processed?: number
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          forecast_rows_inserted?: number
          id?: string
          logs?: Json | null
          run_time?: string
          status?: string
          tenants_processed?: number
        }
        Relationships: []
      }
      forecast_runs: {
        Row: {
          created_at: string
          forecast_job_id: string | null
          id: string
          model_version: string
          notes: string | null
          run_timestamp: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          forecast_job_id?: string | null
          id?: string
          model_version?: string
          notes?: string | null
          run_timestamp?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          forecast_job_id?: string | null
          id?: string
          model_version?: string
          notes?: string | null
          run_timestamp?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_runs_forecast_job_id_fkey"
            columns: ["forecast_job_id"]
            isOneToOne: false
            referencedRelation: "forecast_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_validations: {
        Row: {
          check_name: string
          created_at: string
          forecast_run_id: string
          id: string
          message: string | null
          metadata: Json | null
          status: string
          tenant_id: string
        }
        Insert: {
          check_name: string
          created_at?: string
          forecast_run_id: string
          id?: string
          message?: string | null
          metadata?: Json | null
          status: string
          tenant_id: string
        }
        Update: {
          check_name?: string
          created_at?: string
          forecast_run_id?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_validations_forecast_run_id_fkey"
            columns: ["forecast_run_id"]
            isOneToOne: false
            referencedRelation: "forecast_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_validations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_notes: {
        Row: {
          created_at: string
          created_by: string | null
          grn_number: string
          id: string
          journal_entry_id: string | null
          notes: string | null
          po_id: string | null
          posted_at: string | null
          receipt_date: string
          status: string
          tenant_id: string
          total_value: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grn_number: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          po_id?: string | null
          posted_at?: string | null
          receipt_date?: string
          status?: string
          tenant_id: string
          total_value?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grn_number?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          po_id?: string | null
          posted_at?: string | null
          receipt_date?: string
          status?: string
          tenant_id?: string
          total_value?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_notes_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_notes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_lines: {
        Row: {
          created_at: string
          grn_id: string
          id: string
          item_id: string
          line_total: number
          po_line_id: string | null
          qty_billed: number
          qty_received: number
          tenant_id: string
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          grn_id: string
          id?: string
          item_id: string
          line_total?: number
          po_line_id?: string | null
          qty_billed?: number
          qty_received: number
          tenant_id: string
          unit_cost: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          grn_id?: string
          id?: string
          item_id?: string
          line_total?: number
          po_line_id?: string | null
          qty_billed?: number
          qty_received?: number
          tenant_id?: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grn_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      insights: {
        Row: {
          created_at: string
          id: string
          message: string
          severity: string
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          severity?: string
          tenant_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          severity?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          account_id: string | null
          adjustment_account_id: string | null
          category: string | null
          cogs_account_id: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          item_code: string | null
          item_name: string
          last_purchase_price: number | null
          max_stock_level: number | null
          notes: string | null
          purchase_account_id: string | null
          purchase_return_account_id: string | null
          quantity_on_hand: number
          reorder_level: number | null
          reorder_quantity: number | null
          sales_return_account_id: string | null
          selling_price: number | null
          sku: string | null
          standard_cost: number | null
          sub_category: string | null
          tax_id: string | null
          tenant_id: string
          unit_cost: number
          uom_conversion_factor: number | null
          uom_primary: string | null
          uom_secondary: string | null
          updated_at: string
          valuation_method: string
          weight: number | null
        }
        Insert: {
          account_id?: string | null
          adjustment_account_id?: string | null
          category?: string | null
          cogs_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          item_code?: string | null
          item_name: string
          last_purchase_price?: number | null
          max_stock_level?: number | null
          notes?: string | null
          purchase_account_id?: string | null
          purchase_return_account_id?: string | null
          quantity_on_hand?: number
          reorder_level?: number | null
          reorder_quantity?: number | null
          sales_return_account_id?: string | null
          selling_price?: number | null
          sku?: string | null
          standard_cost?: number | null
          sub_category?: string | null
          tax_id?: string | null
          tenant_id: string
          unit_cost?: number
          uom_conversion_factor?: number | null
          uom_primary?: string | null
          uom_secondary?: string | null
          updated_at?: string
          valuation_method?: string
          weight?: number | null
        }
        Update: {
          account_id?: string | null
          adjustment_account_id?: string | null
          category?: string | null
          cogs_account_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          item_code?: string | null
          item_name?: string
          last_purchase_price?: number | null
          max_stock_level?: number | null
          notes?: string | null
          purchase_account_id?: string | null
          purchase_return_account_id?: string | null
          quantity_on_hand?: number
          reorder_level?: number | null
          reorder_quantity?: number | null
          sales_return_account_id?: string | null
          selling_price?: number | null
          sku?: string | null
          standard_cost?: number | null
          sub_category?: string | null
          tax_id?: string | null
          tenant_id?: string
          unit_cost?: number
          uom_conversion_factor?: number | null
          uom_primary?: string | null
          uom_secondary?: string | null
          updated_at?: string
          valuation_method?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_adjustment_account_id_fkey"
            columns: ["adjustment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_cogs_account_id_fkey"
            columns: ["cogs_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_purchase_account_id_fkey"
            columns: ["purchase_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_purchase_return_account_id_fkey"
            columns: ["purchase_return_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_sales_return_account_id_fkey"
            columns: ["sales_return_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_subledger: {
        Row: {
          amount: number
          balance: number
          created_at: string
          credit: number
          debit: number
          document_id: string | null
          document_type: string | null
          id: string
          item_id: string
          journal_id: string | null
          journal_line_id: string
          qty: number
          rate: number
          tenant_id: string
        }
        Insert: {
          amount?: number
          balance?: number
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          id?: string
          item_id: string
          journal_id?: string | null
          journal_line_id: string
          qty?: number
          rate?: number
          tenant_id: string
        }
        Update: {
          amount?: number
          balance?: number
          created_at?: string
          credit?: number
          debit?: number
          document_id?: string | null
          document_type?: string | null
          id?: string
          item_id?: string
          journal_id?: string | null
          journal_line_id?: string
          qty?: number
          rate?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_subledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_subledger_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_subledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          account_id: string | null
          description: string | null
          id: string
          inventory_item_id: string | null
          invoice_id: string
          product_id: string | null
          quantity: number
          tax_id: string | null
          total: number
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          description?: string | null
          id?: string
          inventory_item_id?: string | null
          invoice_id: string
          product_id?: string | null
          quantity?: number
          tax_id?: string | null
          total?: number
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          description?: string | null
          id?: string
          inventory_item_id?: string | null
          invoice_id?: string
          product_id?: string | null
          quantity?: number
          tax_id?: string | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          layout_json: Json
          page_settings: Json
          table_settings: Json
          template_name: string
          template_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          layout_json?: Json
          page_settings?: Json
          table_settings?: Json
          template_name: string
          template_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          layout_json?: Json
          page_settings?: Json
          table_settings?: Json
          template_name?: string
          template_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          ar_account_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          discount_amount: number
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          journal_entry_id: string | null
          notes: string | null
          posted_at: string | null
          posted_by: string | null
          revenue_account_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          template_id: string | null
          tenant_id: string
          terms: string | null
          total_amount: number
          updated_at: string
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          ar_account_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_amount?: number
          due_date?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          revenue_account_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          template_id?: string | null
          tenant_id: string
          terms?: string | null
          total_amount?: number
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          ar_account_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          discount_amount?: number
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          revenue_account_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          template_id?: string | null
          tenant_id?: string
          terms?: string | null
          total_amount?: number
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "invoice_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          cash_flow_category: string | null
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          entry_type: string | null
          id: string
          is_system_generated: boolean
          obe_batch_id: string | null
          posted_at: string | null
          reference: string | null
          reversal_of: string | null
          source_id: string | null
          source_type: string | null
          status: string
          tenant_id: string
          unique_key: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          cash_flow_category?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          entry_date?: string
          entry_type?: string | null
          id?: string
          is_system_generated?: boolean
          obe_batch_id?: string | null
          posted_at?: string | null
          reference?: string | null
          reversal_of?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          tenant_id: string
          unique_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          cash_flow_category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          entry_type?: string | null
          id?: string
          is_system_generated?: boolean
          obe_batch_id?: string | null
          posted_at?: string | null
          reference?: string | null
          reversal_of?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: string
          tenant_id?: string
          unique_key?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          asset_id: string | null
          cost_center_id: string | null
          credit: number
          customer_id: string | null
          debit: number
          id: string
          item_id: string | null
          journal_entry_id: string
          vendor_id: string | null
        }
        Insert: {
          account_id: string
          asset_id?: string | null
          cost_center_id?: string | null
          credit?: number
          customer_id?: string | null
          debit?: number
          id?: string
          item_id?: string | null
          journal_entry_id: string
          vendor_id?: string | null
        }
        Update: {
          account_id?: string
          asset_id?: string | null
          cost_center_id?: string | null
          credit?: number
          customer_id?: string | null
          debit?: number
          id?: string
          item_id?: string | null
          journal_entry_id?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      landed_cost_allocations: {
        Row: {
          allocated_amount: number
          basis_value: number
          created_at: string
          grn_line_id: string
          id: string
          item_id: string
          tenant_id: string
          voucher_id: string
        }
        Insert: {
          allocated_amount: number
          basis_value: number
          created_at?: string
          grn_line_id: string
          id?: string
          item_id: string
          tenant_id: string
          voucher_id: string
        }
        Update: {
          allocated_amount?: number
          basis_value?: number
          created_at?: string
          grn_line_id?: string
          id?: string
          item_id?: string
          tenant_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landed_cost_allocations_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_cost_allocations_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_cost_allocations_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "landed_cost_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      landed_cost_charges: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          offset_account_id: string
          tenant_id: string
          voucher_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          offset_account_id: string
          tenant_id: string
          voucher_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          offset_account_id?: string
          tenant_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landed_cost_charges_offset_account_id_fkey"
            columns: ["offset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_cost_charges_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "landed_cost_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      landed_cost_voucher_grns: {
        Row: {
          grn_id: string
          id: string
          tenant_id: string
          voucher_id: string
        }
        Insert: {
          grn_id: string
          id?: string
          tenant_id: string
          voucher_id: string
        }
        Update: {
          grn_id?: string
          id?: string
          tenant_id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landed_cost_voucher_grns_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landed_cost_voucher_grns_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "landed_cost_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      landed_cost_vouchers: {
        Row: {
          allocation_method: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          posted_at: string | null
          status: string
          tenant_id: string
          total_charges: number
          updated_at: string
          voucher_date: string
          voucher_number: string
        }
        Insert: {
          allocation_method?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          tenant_id: string
          total_charges?: number
          updated_at?: string
          voucher_date?: string
          voucher_number: string
        }
        Update: {
          allocation_method?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          tenant_id?: string
          total_charges?: number
          updated_at?: string
          voucher_date?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "landed_cost_vouchers_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_balances: {
        Row: {
          account_id: string
          closing_balance: number
          id: string
          opening_balance: number
          period: string
          updated_at: string
        }
        Insert: {
          account_id: string
          closing_balance?: number
          id?: string
          opening_balance?: number
          period: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          closing_balance?: number
          id?: string
          opening_balance?: number
          period?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          tenant_id: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          tenant_id: string
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          tenant_id?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_balance_details: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          amount?: number
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_balance_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_balance_details_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_balances: {
        Row: {
          account_id: string
          balance: number
          created_at: string
          credit: number
          debit: number
          fiscal_period_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          balance?: number
          created_at?: string
          credit?: number
          debit?: number
          fiscal_period_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          balance?: number
          created_at?: string
          credit?: number
          debit?: number
          fiscal_period_id?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_balances_fiscal_period_id_fkey"
            columns: ["fiscal_period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opening_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_schedules: {
        Row: {
          anchor_date: string | null
          created_at: string
          description: string | null
          frequency: string
          id: string
          name: string
          tenant_id: string
        }
        Insert: {
          anchor_date?: string | null
          created_at?: string
          description?: string | null
          frequency?: string
          id?: string
          name: string
          tenant_id: string
        }
        Update: {
          anchor_date?: string | null
          created_at?: string
          description?: string | null
          frequency?: string
          id?: string
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_voucher_lines: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          description: string | null
          id: string
          voucher_id: string
        }
        Insert: {
          account_id: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          voucher_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_voucher_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_voucher_lines_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "payment_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_vouchers: {
        Row: {
          account_number: string | null
          accountant: string | null
          approved_by: string | null
          bills_attached: number | null
          checked_by: string | null
          cheque_number: string | null
          created_at: string
          id: string
          journal_entry_id: string | null
          made_by: string | null
          memo: string | null
          payee_id: string | null
          payment_account_id: string
          payment_date: string
          payment_method: string
          reference_number: string | null
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
          voucher_number: string
        }
        Insert: {
          account_number?: string | null
          accountant?: string | null
          approved_by?: string | null
          bills_attached?: number | null
          checked_by?: string | null
          cheque_number?: string | null
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          made_by?: string | null
          memo?: string | null
          payee_id?: string | null
          payment_account_id: string
          payment_date?: string
          payment_method?: string
          reference_number?: string | null
          status?: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
          voucher_number: string
        }
        Update: {
          account_number?: string | null
          accountant?: string | null
          approved_by?: string | null
          bills_attached?: number | null
          checked_by?: string | null
          cheque_number?: string | null
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          made_by?: string | null
          memo?: string | null
          payee_id?: string | null
          payment_account_id?: string
          payment_date?: string
          payment_method?: string
          reference_number?: string | null
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_vouchers_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_vouchers_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_vouchers_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          payment_date: string
          payment_method: string | null
          status: string
          subscription_id: string
          transaction_reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          payment_date?: string
          payment_method?: string | null
          status?: string
          subscription_id: string
          transaction_reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          payment_date?: string
          payment_method?: string | null
          status?: string
          subscription_id?: string
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      payments_received: {
        Row: {
          amount: number
          ar_account_id: string | null
          bank_account_id: string | null
          id: string
          invoice_id: string
          journal_entry_id: string | null
          payment_date: string
          payment_method: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          ar_account_id?: string | null
          bank_account_id?: string | null
          id?: string
          invoice_id: string
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          ar_account_id?: string | null
          bank_account_id?: string | null
          id?: string
          invoice_id?: string
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_received_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_component_accounts: {
        Row: {
          account_id: string
          component_code: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          posting_side: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          component_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          posting_side: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          component_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          posting_side?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_component_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_component_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_components: {
        Row: {
          code: string
          created_at: string
          description: string | null
          gl_credit_account_id: string | null
          gl_debit_account_id: string | null
          id: string
          is_active: boolean
          is_statutory: boolean
          is_taxable: boolean
          kind: string
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          gl_credit_account_id?: string | null
          gl_debit_account_id?: string | null
          id?: string
          is_active?: boolean
          is_statutory?: boolean
          is_taxable?: boolean
          kind: string
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          gl_credit_account_id?: string | null
          gl_debit_account_id?: string | null
          id?: string
          is_active?: boolean
          is_statutory?: boolean
          is_taxable?: boolean
          kind?: string
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_components_gl_credit_account_id_fkey"
            columns: ["gl_credit_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_components_gl_debit_account_id_fkey"
            columns: ["gl_debit_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_components_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_earning_types: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          is_statutory: boolean
          is_taxable: boolean
          name: string
          rate: number | null
          tenant_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_statutory?: boolean
          is_taxable?: boolean
          name: string
          rate?: number | null
          tenant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_statutory?: boolean
          is_taxable?: boolean
          name?: string
          rate?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_earning_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_item_details: {
        Row: {
          amount: number
          category: string
          created_at: string
          earning_type_id: string | null
          id: string
          name: string
          run_item_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          earning_type_id?: string | null
          id?: string
          name: string
          run_item_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          earning_type_id?: string | null
          id?: string
          name?: string
          run_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_item_details_earning_type_id_fkey"
            columns: ["earning_type_id"]
            isOneToOne: false
            referencedRelation: "payroll_earning_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_item_details_run_item_id_fkey"
            columns: ["run_item_id"]
            isOneToOne: false
            referencedRelation: "payroll_run_items"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_records: {
        Row: {
          created_at: string
          deductions: number
          employee_id: string
          gross_salary: number
          id: string
          net_salary: number
          payment_date: string | null
          period_end: string
          period_start: string
        }
        Insert: {
          created_at?: string
          deductions?: number
          employee_id: string
          gross_salary?: number
          id?: string
          net_salary?: number
          payment_date?: string | null
          period_end: string
          period_start: string
        }
        Update: {
          created_at?: string
          deductions?: number
          employee_id?: string
          gross_salary?: number
          id?: string
          net_salary?: number
          payment_date?: string | null
          period_end?: string
          period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_results: {
        Row: {
          calculation_trace: Json | null
          component_code: string
          component_name: string
          created_at: string
          employee_id: string
          id: string
          rule_id: string | null
          rule_version_id: string | null
          run_id: string
          tenant_id: string
          value: number
        }
        Insert: {
          calculation_trace?: Json | null
          component_code: string
          component_name: string
          created_at?: string
          employee_id: string
          id?: string
          rule_id?: string | null
          rule_version_id?: string | null
          run_id: string
          tenant_id: string
          value?: number
        }
        Update: {
          calculation_trace?: Json | null
          component_code?: string
          component_name?: string
          created_at?: string
          employee_id?: string
          id?: string
          rule_id?: string | null
          rule_version_id?: string | null
          run_id?: string
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_results_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_results_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "payroll_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_results_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "payroll_rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rule_versions: {
        Row: {
          base_component_code: string | null
          condition_json: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          effective_from: string | null
          effective_to: string | null
          expression: string | null
          formula_type: string
          formula_value: number
          id: string
          is_active: boolean
          name: string
          priority: number
          rule_id: string
          target_component_code: string
          tenant_id: string
          version_no: number
        }
        Insert: {
          base_component_code?: string | null
          condition_json?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expression?: string | null
          formula_type: string
          formula_value?: number
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          rule_id: string
          target_component_code: string
          tenant_id: string
          version_no: number
        }
        Update: {
          base_component_code?: string | null
          condition_json?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expression?: string | null
          formula_type?: string
          formula_value?: number
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          rule_id?: string
          target_component_code?: string
          tenant_id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_rule_versions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "payroll_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_rule_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_rules: {
        Row: {
          base_component_code: string | null
          condition_json: Json | null
          created_at: string
          description: string | null
          effective_from: string | null
          effective_to: string | null
          expression: string | null
          formula_type: string
          formula_value: number
          id: string
          is_active: boolean
          name: string
          priority: number
          target_component_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_component_code?: string | null
          condition_json?: Json | null
          created_at?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expression?: string | null
          formula_type: string
          formula_value?: number
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          target_component_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_component_code?: string | null
          condition_json?: Json | null
          created_at?: string
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          expression?: string | null
          formula_type?: string
          formula_value?: number
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          target_component_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_items: {
        Row: {
          allowances: number
          basic_salary: number
          bonuses: number
          created_at: string
          employee_epf: number
          employee_id: string
          employer_epf: number
          employer_etf: number
          gross_pay: number
          hours_worked: number | null
          id: string
          net_pay: number
          notes: string | null
          other_deductions: number
          overtime_hours: number | null
          overtime_pay: number
          payment_method: string
          run_id: string
        }
        Insert: {
          allowances?: number
          basic_salary?: number
          bonuses?: number
          created_at?: string
          employee_epf?: number
          employee_id: string
          employer_epf?: number
          employer_etf?: number
          gross_pay?: number
          hours_worked?: number | null
          id?: string
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          overtime_hours?: number | null
          overtime_pay?: number
          payment_method?: string
          run_id: string
        }
        Update: {
          allowances?: number
          basic_salary?: number
          bonuses?: number
          created_at?: string
          employee_epf?: number
          employee_id?: string
          employer_epf?: number
          employer_etf?: number
          gross_pay?: number
          hours_worked?: number | null
          id?: string
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          overtime_hours?: number | null
          overtime_pay?: number
          payment_method?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run_snapshots: {
        Row: {
          created_at: string
          employee_snapshots: Json
          id: string
          rule_set: Json
          rule_set_version_hash: string
          run_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          employee_snapshots: Json
          id?: string
          rule_set: Json
          rule_set_version_hash: string
          run_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          employee_snapshots?: Json
          id?: string
          rule_set?: Json
          rule_set_version_hash?: string
          run_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          adjusts_run_id: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          finalized_at: string | null
          finalized_by: string | null
          id: string
          is_adjustment: boolean
          journal_entry_id: string | null
          notes: string | null
          pay_schedule_id: string | null
          payment_date: string | null
          period_end: string
          period_start: string
          rule_set_version_hash: string | null
          run_number: string
          status: string
          tenant_id: string
          total_deductions: number
          total_employer_epf: number
          total_employer_etf: number
          total_gross: number
          total_net: number
          updated_at: string
        }
        Insert: {
          adjusts_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_adjustment?: boolean
          journal_entry_id?: string | null
          notes?: string | null
          pay_schedule_id?: string | null
          payment_date?: string | null
          period_end: string
          period_start: string
          rule_set_version_hash?: string | null
          run_number: string
          status?: string
          tenant_id: string
          total_deductions?: number
          total_employer_epf?: number
          total_employer_etf?: number
          total_gross?: number
          total_net?: number
          updated_at?: string
        }
        Update: {
          adjusts_run_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          is_adjustment?: boolean
          journal_entry_id?: string | null
          notes?: string | null
          pay_schedule_id?: string | null
          payment_date?: string | null
          period_end?: string
          period_start?: string
          rule_set_version_hash?: string | null
          run_number?: string
          status?: string
          tenant_id?: string
          total_deductions?: number
          total_employer_epf?: number
          total_employer_etf?: number
          total_gross?: number
          total_net?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_adjusts_run_id_fkey"
            columns: ["adjusts_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_pay_schedule_id_fkey"
            columns: ["pay_schedule_id"]
            isOneToOne: false
            referencedRelation: "pay_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string | null
          id: string
          permission_name: string
        }
        Insert: {
          description?: string | null
          id?: string
          permission_name: string
        }
        Update: {
          description?: string | null
          id?: string
          permission_name?: string
        }
        Relationships: []
      }
      petty_cash_accounts: {
        Row: {
          account_id: string
          account_name: string
          created_at: string
          float_amount: number
          id: string
          is_active: boolean
          tenant_id: string
        }
        Insert: {
          account_id: string
          account_name: string
          created_at?: string
          float_amount?: number
          id?: string
          is_active?: boolean
          tenant_id: string
        }
        Update: {
          account_id?: string
          account_name?: string
          created_at?: string
          float_amount?: number
          id?: string
          is_active?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_replenishments: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          date: string
          id: string
          journal_entry_id: string | null
          petty_cash_account_id: string
          replenishment_number: string
          status: string
          tenant_id: string
        }
        Insert: {
          amount?: number
          bank_account_id: string
          created_at?: string
          date?: string
          id?: string
          journal_entry_id?: string | null
          petty_cash_account_id: string
          replenishment_number: string
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          date?: string
          id?: string
          journal_entry_id?: string | null
          petty_cash_account_id?: string
          replenishment_number?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_replenishments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_petty_cash_account_id_fkey"
            columns: ["petty_cash_account_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_replenishments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_voucher_lines: {
        Row: {
          account_id: string
          amount: number
          date: string
          description: string | null
          id: string
          line_no: number
          voucher_id: string
        }
        Insert: {
          account_id: string
          amount?: number
          date?: string
          description?: string | null
          id?: string
          line_no?: number
          voucher_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          date?: string
          description?: string | null
          id?: string
          line_no?: number
          voucher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_voucher_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_voucher_lines_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_vouchers: {
        Row: {
          approved_at: string | null
          authorized_by: string | null
          created_at: string
          date: string
          id: string
          journal_entry_id: string | null
          paid_to: string | null
          petty_cash_account_id: string
          prepared_by: string | null
          receipt_urls: string[] | null
          reversal_voucher_id: string | null
          reversed_at: string | null
          status: string
          tenant_id: string
          total_amount: number
          voucher_number: string
        }
        Insert: {
          approved_at?: string | null
          authorized_by?: string | null
          created_at?: string
          date?: string
          id?: string
          journal_entry_id?: string | null
          paid_to?: string | null
          petty_cash_account_id: string
          prepared_by?: string | null
          receipt_urls?: string[] | null
          reversal_voucher_id?: string | null
          reversed_at?: string | null
          status?: string
          tenant_id: string
          total_amount?: number
          voucher_number: string
        }
        Update: {
          approved_at?: string | null
          authorized_by?: string | null
          created_at?: string
          date?: string
          id?: string
          journal_entry_id?: string | null
          paid_to?: string | null
          petty_cash_account_id?: string
          prepared_by?: string | null
          receipt_urls?: string[] | null
          reversal_voucher_id?: string | null
          reversed_at?: string | null
          status?: string
          tenant_id?: string
          total_amount?: number
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_vouchers_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_petty_cash_account_id_fkey"
            columns: ["petty_cash_account_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_reversal_voucher_id_fkey"
            columns: ["reversal_voucher_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_vouchers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_vouchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          category_name: string
          id: string
          tenant_id: string
        }
        Insert: {
          category_name: string
          id?: string
          tenant_id: string
        }
        Update: {
          category_name?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          asset_account_id: string | null
          created_at: string
          description: string | null
          expense_account_id: string | null
          id: string
          income_account_id: string | null
          inventory_item_id: string | null
          is_tracked: boolean
          name: string
          price: number
          tax_id: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          asset_account_id?: string | null
          created_at?: string
          description?: string | null
          expense_account_id?: string | null
          id?: string
          income_account_id?: string | null
          inventory_item_id?: string | null
          is_tracked?: boolean
          name: string
          price?: number
          tax_id?: string | null
          tenant_id: string
          type?: string
        }
        Update: {
          asset_account_id?: string | null
          created_at?: string
          description?: string | null
          expense_account_id?: string | null
          id?: string
          income_account_id?: string | null
          inventory_item_id?: string | null
          is_tracked?: boolean
          name?: string
          price?: number
          tax_id?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_income_account_id_fkey"
            columns: ["income_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          created_at: string
          description: string | null
          id: string
          item_id: string
          line_total: number
          po_id: string
          qty_ordered: number
          qty_received: number
          tax_id: string | null
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          item_id: string
          line_total?: number
          po_id: string
          qty_ordered: number
          qty_received?: number
          tax_id?: string | null
          tenant_id: string
          unit_cost: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          item_id?: string
          line_total?: number
          po_id?: string
          qty_ordered?: number
          qty_received?: number
          tax_id?: string | null
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          expected_date: string | null
          id: string
          notes: string | null
          order_date: string
          po_number: string
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          total_amount: number
          updated_at: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          po_number: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total_amount?: number
          updated_at?: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          expected_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          po_number?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_total: number
          pr_id: string
          qty: number
          tenant_id: string
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_total?: number
          pr_id: string
          qty: number
          tenant_id: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_total?: number
          pr_id?: string
          qty?: number
          tenant_id?: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_lines_pr_id_fkey"
            columns: ["pr_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          bill_id: string | null
          created_at: string
          created_by: string | null
          grn_id: string | null
          id: string
          journal_entry_id: string | null
          posted_at: string | null
          pr_number: string
          reason: string | null
          return_date: string
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
          vendor_id: string | null
          warehouse_id: string | null
        }
        Insert: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          id?: string
          journal_entry_id?: string | null
          posted_at?: string | null
          pr_number: string
          reason?: string | null
          return_date?: string
          status?: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
          vendor_id?: string | null
          warehouse_id?: string | null
        }
        Update: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          grn_id?: string | null
          id?: string
          journal_entry_id?: string | null
          posted_at?: string | null
          pr_number?: string
          reason?: string | null
          return_date?: string
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          vendor_id?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_adjustments: {
        Row: {
          adjustment_type: string
          amount: number
          created_at: string
          description: string | null
          id: string
          journal_entry_id: string | null
          reconciliation_id: string
        }
        Insert: {
          adjustment_type?: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          reconciliation_id: string
        }
        Update: {
          adjustment_type?: string
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          journal_entry_id?: string | null
          reconciliation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_adjustments_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_invariant_log: {
        Row: {
          actual: number | null
          checked_at: string
          delta: number | null
          details: Json | null
          expected: number | null
          id: string
          invariant_name: string
          passed: boolean
          reconciliation_id: string
          tenant_id: string
        }
        Insert: {
          actual?: number | null
          checked_at?: string
          delta?: number | null
          details?: Json | null
          expected?: number | null
          id?: string
          invariant_name: string
          passed: boolean
          reconciliation_id: string
          tenant_id: string
        }
        Update: {
          actual?: number | null
          checked_at?: string
          delta?: number | null
          details?: Json | null
          expected?: number | null
          id?: string
          invariant_name?: string
          passed?: boolean
          reconciliation_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_invariant_log_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_invariant_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_logs: {
        Row: {
          action: string
          affected_transaction_id: string | null
          created_at: string
          details: Json | null
          id: string
          reconciliation_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          affected_transaction_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          reconciliation_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          affected_transaction_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          reconciliation_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_logs_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_rules: {
        Row: {
          action_account_id: string | null
          action_create_expense: boolean
          action_type: string
          condition_amount_max: number | null
          condition_amount_min: number | null
          condition_field: string
          condition_operator: string
          condition_value: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          priority: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_account_id?: string | null
          action_create_expense?: boolean
          action_type?: string
          condition_amount_max?: number | null
          condition_amount_min?: number | null
          condition_field?: string
          condition_operator?: string
          condition_value: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_account_id?: string | null
          action_create_expense?: boolean
          action_type?: string
          condition_amount_max?: number | null
          condition_amount_min?: number | null
          condition_field?: string
          condition_operator?: string
          condition_value?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_rules_action_account_id_fkey"
            columns: ["action_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_snapshots: {
        Row: {
          as_of_date: string
          bank_account_id: string
          bank_balance: number
          bank_txn_count: number
          cleared_balance: number
          created_at: string
          created_by: string | null
          difference: number
          id: string
          ledger_balance: number
          ledger_line_count: number
          payload: Json
          reconciliation_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          as_of_date: string
          bank_account_id: string
          bank_balance?: number
          bank_txn_count?: number
          cleared_balance?: number
          created_at?: string
          created_by?: string | null
          difference?: number
          id?: string
          ledger_balance?: number
          ledger_line_count?: number
          payload?: Json
          reconciliation_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          as_of_date?: string
          bank_account_id?: string
          bank_balance?: number
          bank_txn_count?: number
          cleared_balance?: number
          created_at?: string
          created_by?: string | null
          difference?: number
          id?: string
          ledger_balance?: number
          ledger_line_count?: number
          payload?: Json
          reconciliation_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_snapshots_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_snapshots_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_transactions: {
        Row: {
          cleared: boolean
          cleared_date: string | null
          created_at: string
          id: string
          journal_line_id: string
          reconciliation_id: string
        }
        Insert: {
          cleared?: boolean
          cleared_date?: string | null
          created_at?: string
          id?: string
          journal_line_id: string
          reconciliation_id: string
        }
        Update: {
          cleared?: boolean
          cleared_date?: string | null
          created_at?: string
          id?: string
          journal_line_id?: string
          reconciliation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_transactions_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_transactions_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "bank_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_cache: {
        Row: {
          data_json: Json | null
          generated_at: string
          id: string
          report_name: string
          tenant_id: string
        }
        Insert: {
          data_json?: Json | null
          generated_at?: string
          id?: string
          report_name: string
          tenant_id: string
        }
        Update: {
          data_json?: Json | null
          generated_at?: string
          id?: string
          report_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_cache_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          id: string
          role_name: string
        }
        Insert: {
          description?: string | null
          id?: string
          role_name: string
        }
        Update: {
          description?: string | null
          id?: string
          role_name?: string
        }
        Relationships: []
      }
      sales_return_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          line_cost: number
          line_total: number
          qty: number
          sr_id: string
          tenant_id: string
          unit_cost: number
          unit_price: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          line_cost?: number
          line_total?: number
          qty: number
          sr_id: string
          tenant_id: string
          unit_cost?: number
          unit_price?: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          line_cost?: number
          line_total?: number
          qty?: number
          sr_id?: string
          tenant_id?: string
          unit_cost?: number
          unit_price?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_return_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_lines_sr_id_fkey"
            columns: ["sr_id"]
            isOneToOne: false
            referencedRelation: "sales_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_returns: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          posted_at: string | null
          reason: string | null
          return_date: string
          sr_number: string
          status: string
          tenant_id: string
          total_amount: number
          total_cogs: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          posted_at?: string | null
          reason?: string | null
          return_date?: string
          sr_number: string
          status?: string
          tenant_id: string
          total_amount?: number
          total_cogs?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          posted_at?: string | null
          reason?: string | null
          return_date?: string
          sr_number?: string
          status?: string
          tenant_id?: string
          total_amount?: number
          total_cogs?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_returns_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_models: {
        Row: {
          base_forecast_run_id: string | null
          baseline_cash: number
          baseline_expense: number
          baseline_revenue: number
          capital_injection: number
          created_at: string
          created_by: string | null
          description: string | null
          discount_rate: number
          expense_reduction_pct: number
          horizon_months: number
          id: string
          input_parameters: Json | null
          irr: number | null
          name: string
          npv: number | null
          one_time_investment: number
          payback_months: number | null
          projected_cash: number
          projected_expense: number
          projected_profit: number
          projected_revenue: number
          result_series: Json | null
          revenue_uplift_pct: number
          roi_pct: number
          tenant_id: string
          time_horizon_years: number
          updated_at: string
        }
        Insert: {
          base_forecast_run_id?: string | null
          baseline_cash?: number
          baseline_expense?: number
          baseline_revenue?: number
          capital_injection?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_rate?: number
          expense_reduction_pct?: number
          horizon_months?: number
          id?: string
          input_parameters?: Json | null
          irr?: number | null
          name: string
          npv?: number | null
          one_time_investment?: number
          payback_months?: number | null
          projected_cash?: number
          projected_expense?: number
          projected_profit?: number
          projected_revenue?: number
          result_series?: Json | null
          revenue_uplift_pct?: number
          roi_pct?: number
          tenant_id: string
          time_horizon_years?: number
          updated_at?: string
        }
        Update: {
          base_forecast_run_id?: string | null
          baseline_cash?: number
          baseline_expense?: number
          baseline_revenue?: number
          capital_injection?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_rate?: number
          expense_reduction_pct?: number
          horizon_months?: number
          id?: string
          input_parameters?: Json | null
          irr?: number | null
          name?: string
          npv?: number | null
          one_time_investment?: number
          payback_months?: number | null
          projected_cash?: number
          projected_expense?: number
          projected_profit?: number
          projected_revenue?: number
          result_series?: Json | null
          revenue_uplift_pct?: number
          roi_pct?: number
          tenant_id?: string
          time_horizon_years?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenario_models_base_forecast_run_id_fkey"
            columns: ["base_forecast_run_id"]
            isOneToOne: false
            referencedRelation: "forecast_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenario_models_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment_lines: {
        Row: {
          adjustment_id: string
          created_at: string
          id: string
          item_id: string
          line_value: number
          notes: string | null
          qty_delta: number
          tenant_id: string
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          adjustment_id: string
          created_at?: string
          id?: string
          item_id: string
          line_value?: number
          notes?: string | null
          qty_delta: number
          tenant_id: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Update: {
          adjustment_id?: string
          created_at?: string
          id?: string
          item_id?: string
          line_value?: number
          notes?: string | null
          qty_delta?: number
          tenant_id?: string
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_lines_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_date: string
          adjustment_number: string | null
          adjustment_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          reason: string | null
          rejection_reason: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          tenant_id: string
          total_value: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          adjustment_date?: string
          adjustment_number?: string | null
          adjustment_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          reason?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id: string
          total_value?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          adjustment_date?: string
          adjustment_number?: string | null
          adjustment_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          reason?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id?: string
          total_value?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          count_id: string
          counted_qty: number | null
          created_at: string
          id: string
          item_id: string
          notes: string | null
          system_qty: number
          tenant_id: string
          unit_cost: number
          variance_qty: number
          variance_value: number
          warehouse_id: string | null
        }
        Insert: {
          count_id: string
          counted_qty?: number | null
          created_at?: string
          id?: string
          item_id: string
          notes?: string | null
          system_qty?: number
          tenant_id: string
          unit_cost?: number
          variance_qty?: number
          variance_value?: number
          warehouse_id?: string | null
        }
        Update: {
          count_id?: string
          counted_qty?: number | null
          created_at?: string
          id?: string
          item_id?: string
          notes?: string | null
          system_qty?: number
          tenant_id?: string
          unit_cost?: number
          variance_qty?: number
          variance_value?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          adjustment_id: string | null
          count_date: string
          count_number: string
          created_at: string
          created_by: string | null
          freeze_stock: boolean
          id: string
          journal_entry_id: string | null
          notes: string | null
          posted_at: string | null
          reason: string | null
          status: string
          tenant_id: string
          total_variance_qty: number
          total_variance_value: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          adjustment_id?: string | null
          count_date?: string
          count_number: string
          created_at?: string
          created_by?: string | null
          freeze_stock?: boolean
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          reason?: string | null
          status?: string
          tenant_id: string
          total_variance_qty?: number
          total_variance_value?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          adjustment_id?: string | null
          count_date?: string
          count_number?: string
          created_at?: string
          created_by?: string | null
          freeze_stock?: boolean
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          reason?: string | null
          status?: string
          tenant_id?: string
          total_variance_qty?: number
          total_variance_value?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lot_consumptions: {
        Row: {
          consumption_date: string
          created_at: string
          id: string
          item_id: string
          lot_id: string
          movement_id: string | null
          qty_consumed: number
          reference_id: string | null
          reference_type: string | null
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          consumption_date?: string
          created_at?: string
          id?: string
          item_id: string
          lot_id: string
          movement_id?: string | null
          qty_consumed: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id: string
          unit_cost: number
        }
        Update: {
          consumption_date?: string
          created_at?: string
          id?: string
          item_id?: string
          lot_id?: string
          movement_id?: string | null
          qty_consumed?: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_lot_consumptions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lot_consumptions_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "stock_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lot_consumptions_movement_id_fkey"
            columns: ["movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lot_consumptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_lots: {
        Row: {
          created_at: string
          id: string
          is_exhausted: boolean | null
          item_id: string
          lot_number: string
          notes: string | null
          qty_received: number
          qty_remaining: number
          receipt_date: string
          source_id: string | null
          source_type: string
          tenant_id: string
          unit_cost: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_exhausted?: boolean | null
          item_id: string
          lot_number: string
          notes?: string | null
          qty_received: number
          qty_remaining: number
          receipt_date: string
          source_id?: string | null
          source_type?: string
          tenant_id: string
          unit_cost: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_exhausted?: boolean | null
          item_id?: string
          lot_number?: string
          notes?: string | null
          qty_received?: number
          qty_remaining?: number
          receipt_date?: string
          source_id?: string | null
          source_type?: string
          tenant_id?: string
          unit_cost?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_lots_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_lots_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          id: string
          item_id: string
          movement_date: string
          movement_type: string
          notes: string | null
          quantity: number
          reference_id: string | null
          reference_type: string | null
          tenant_id: string
          total_cost: number | null
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id: string
          total_cost?: number | null
          unit_cost?: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          created_at: string
          id: string
          item_id: string
          quantity: number
          total_cost: number
          transfer_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          quantity: number
          total_cost?: number
          transfer_id: string
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          quantity?: number
          total_cost?: number
          transfer_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          created_by: string | null
          from_warehouse_id: string
          id: string
          in_journal_entry_id: string | null
          notes: string | null
          out_journal_entry_id: string | null
          posted_at: string | null
          status: string
          tenant_id: string
          to_warehouse_id: string
          transfer_date: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_warehouse_id: string
          id?: string
          in_journal_entry_id?: string | null
          notes?: string | null
          out_journal_entry_id?: string | null
          posted_at?: string | null
          status?: string
          tenant_id: string
          to_warehouse_id: string
          transfer_date?: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_warehouse_id?: string
          id?: string
          in_journal_entry_id?: string | null
          notes?: string | null
          out_journal_entry_id?: string | null
          posted_at?: string | null
          status?: string
          tenant_id?: string
          to_warehouse_id?: string
          transfer_date?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_in_journal_entry_id_fkey"
            columns: ["in_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_out_journal_entry_id_fkey"
            columns: ["out_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          billing_cycle: string
          created_at: string
          features_json: Json | null
          id: string
          max_users: number
          name: string
          price: number
        }
        Insert: {
          billing_cycle?: string
          created_at?: string
          features_json?: Json | null
          id?: string
          max_users?: number
          name: string
          price?: number
        }
        Update: {
          billing_cycle?: string
          created_at?: string
          features_json?: Json | null
          id?: string
          max_users?: number
          name?: string
          price?: number
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          payment_provider_id: string | null
          plan_id: string
          start_date: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          payment_provider_id?: string | null
          plan_id: string
          start_date?: string
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          payment_provider_id?: string | null
          plan_id?: string
          start_date?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bill_lines: {
        Row: {
          account_id: string | null
          bill_id: string
          created_at: string
          description: string | null
          grn_line_id: string | null
          id: string
          item_id: string | null
          line_total: number
          qty: number
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          account_id?: string | null
          bill_id: string
          created_at?: string
          description?: string | null
          grn_line_id?: string | null
          id?: string
          item_id?: string | null
          line_total?: number
          qty?: number
          tenant_id: string
          unit_cost: number
        }
        Update: {
          account_id?: string | null
          bill_id?: string
          created_at?: string
          description?: string | null
          grn_line_id?: string | null
          id?: string
          item_id?: string | null
          line_total?: number
          qty?: number
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bill_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "grn_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_bills: {
        Row: {
          amount_paid: number
          bill_date: string
          bill_number: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          posted_at: string | null
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          total_amount: number
          updated_at: string
          vendor_id: string
          vendor_ref: string | null
        }
        Insert: {
          amount_paid?: number
          bill_date?: string
          bill_number: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          total_amount?: number
          updated_at?: string
          vendor_id: string
          vendor_ref?: string | null
        }
        Update: {
          amount_paid?: number
          bill_date?: string
          bill_number?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          posted_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          vendor_id?: string
          vendor_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_bills_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bills_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      system_error_logs: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json | null
          module: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          stack_trace: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          module?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          stack_trace?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          module?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          stack_trace?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_error_logs_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_error_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_records: {
        Row: {
          id: string
          invoice_id: string
          tax_amount: number
          tax_id: string
        }
        Insert: {
          id?: string
          invoice_id: string
          tax_amount?: number
          tax_id: string
        }
        Update: {
          id?: string
          invoice_id?: string
          tax_amount?: number
          tax_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_records_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_records_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          id: string
          tax_name: string
          tax_rate: number
          tenant_id: string
        }
        Insert: {
          id?: string
          tax_name: string
          tax_rate?: number
          tenant_id: string
        }
        Update: {
          id?: string
          tax_name?: string
          tax_rate?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          company_name: string
          country: string | null
          created_at: string
          deleted_at: string | null
          id: string
          industry: string | null
          status: string
          subscription_plan_id: string | null
          updated_at: string
        }
        Insert: {
          company_name: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          status?: string
          subscription_plan_id?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          status?: string
          subscription_plan_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_subscription_plan_id_fkey"
            columns: ["subscription_plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string | null
          id: string
          source_id: string | null
          source_type: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          account_id?: string | null
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          source_id?: string | null
          source_type?: string | null
          tenant_id: string
          type: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          source_id?: string | null
          source_type?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string
          id: string
          module_name: string
          permission_level: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module_name: string
          permission_level?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module_name?: string
          permission_level?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          is_primary: boolean
          last_login_at: string | null
          last_name: string
          login_count: number
          role_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          is_primary?: boolean
          last_login_at?: string | null
          last_name: string
          login_count?: number
          role_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          is_primary?: boolean
          last_login_at?: string | null
          last_name?: string
          login_count?: number
          role_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          opening_balance: number
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          opening_balance?: number
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      cashflow_forecast: {
        Row: {
          created_at: string | null
          date: string | null
          id: string | null
          lower_bound: number | null
          predicted_balance: number | null
          tenant_id: string | null
          upper_bound: number | null
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          id?: string | null
          lower_bound?: number | null
          predicted_balance?: number | null
          tenant_id?: string | null
          upper_bound?: number | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          id?: string | null
          lower_bound?: number | null
          predicted_balance?: number | null
          tenant_id?: string | null
          upper_bound?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_forecasts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_financials: {
        Row: {
          month: string | null
          net: number | null
          tenant_id: string | null
          total_expense: number | null
          total_income: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      budget_vs_actual: {
        Args: {
          p_account_type?: string
          p_department_id?: string
          p_fiscal_year?: number
          p_tenant_id: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          actual: number
          allocated: number
          budget_id: string
          budget_name: string
          department_id: string
          period: string
          period_type: string
          variance: number
          variance_pct: number
        }[]
      }
      calculate_budget_usage: {
        Args: {
          p_account_id: string
          p_department_id?: string
          p_end_date: string
          p_start_date: string
        }
        Returns: {
          actual_amount: number
          allocated_amount: number
          budget_line_id: string
          remaining_amount: number
          utilization_percentage: number
          warning_threshold: number
        }[]
      }
      cancel_stock_count: { Args: { p_count_id: string }; Returns: Json }
      consume_inventory_fifo: {
        Args: {
          p_consumption_date?: string
          p_item_id: string
          p_movement_id: string
          p_quantity: number
          p_reference_id?: string
          p_reference_type?: string
        }
        Returns: Json
      }
      create_payment_voucher: {
        Args: {
          p_account_number?: string
          p_accountant?: string
          p_approved_by?: string
          p_bills_attached?: number
          p_checked_by?: string
          p_cheque_number?: string
          p_lines: Json
          p_made_by?: string
          p_memo?: string
          p_payee_id?: string
          p_payment_account_id: string
          p_payment_date: string
          p_payment_method: string
          p_reference_number?: string
        }
        Returns: string
      }
      derive_period: {
        Args: { p_date: string; p_period_type: string }
        Returns: string
      }
      generate_bill_number: { Args: { p_tenant_id: string }; Returns: string }
      generate_grn_number: { Args: { p_tenant_id: string }; Returns: string }
      generate_item_code: { Args: { p_tenant_id: string }; Returns: string }
      generate_lot_number: {
        Args: { p_item_id: string; p_tenant_id: string }
        Returns: string
      }
      generate_pcr_number: { Args: { p_tenant_id: string }; Returns: string }
      generate_pcv_number: { Args: { p_tenant_id: string }; Returns: string }
      generate_po_number: { Args: { p_tenant_id: string }; Returns: string }
      generate_voucher_number: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      get_category_time_series: {
        Args: {
          p_granularity?: string
          p_lookback_days?: number
          p_tenant_id: string
        }
        Returns: {
          account_type: string
          amount: number
          category_id: string
          category_name: string
          period: string
          stream: string
        }[]
      }
      get_user_permission: {
        Args: { p_module: string; p_user_id: string }
        Returns: string
      }
      get_user_role_name: { Args: never; Returns: string }
      get_user_tenant_id: { Args: never; Returns: string }
      inventory_valuation_report: {
        Args: { p_tenant_id?: string }
        Returns: {
          fifo_value: number
          item_code: string
          item_id: string
          item_name: string
          qty_on_hand: number
          reported_value: number
          unit_cost: number
          valuation_method: string
          wac_value: number
        }[]
      }
      is_cash_or_bank_account: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      is_period_closed: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: boolean
      }
      is_primary_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      post_delivery_note: { Args: { p_id: string }; Returns: Json }
      post_grn: { Args: { p_grn_id: string }; Returns: Json }
      post_landed_cost_voucher: {
        Args: { p_voucher_id: string }
        Returns: Json
      }
      post_purchase_return: { Args: { p_id: string }; Returns: Json }
      post_sales_return: { Args: { p_id: string }; Returns: Json }
      post_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      post_stock_count: { Args: { p_count_id: string }; Returns: Json }
      post_stock_transfer: { Args: { p_transfer_id: string }; Returns: string }
      post_supplier_bill: { Args: { p_bill_id: string }; Returns: Json }
      recalc_budget_consumption: {
        Args: {
          p_account_id: string
          p_class_id: string
          p_department_id: string
          p_period: string
          p_period_type: string
          p_project_id: string
          p_tenant_id: string
        }
        Returns: number
      }
      recalculate_daily_balance: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: undefined
      }
      receive_inventory: {
        Args: {
          p_inventory_item_id: string
          p_notes?: string
          p_payment_account_id: string
          p_quantity: number
          p_receipt_date?: string
          p_reference?: string
          p_unit_cost: number
        }
        Returns: Json
      }
      reject_stock_adjustment: {
        Args: { p_adjustment_id: string; p_reason: string }
        Returns: Json
      }
      seed_default_payroll_engine: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_inventory_coa_accounts: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_stock_count: {
        Args: { p_count_id: string; p_item_ids?: string[] }
        Returns: Json
      }
      submit_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      validate_voucher_budget: {
        Args: {
          p_account_id: string
          p_amount: number
          p_class_id?: string
          p_date: string
          p_department_id?: string
          p_project_id?: string
          p_tenant_id: string
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
