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
    PostgrestVersion: "14.5"
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
          accum_depreciation_account_id: string | null
          accumulated_depreciation_account_id: string | null
          ap_account_id: string | null
          ar_account_id: string | null
          bank_account_id: string | null
          bank_import_amount_ceiling: number
          bank_import_posting_mode: string
          bank_import_unrecognized_deposit_account_id: string | null
          bank_import_unrecognized_payment_account_id: string | null
          cogs_account_id: string | null
          created_at: string
          credit_note_approval_threshold: number | null
          customer_advance_account_id: string | null
          depreciation_expense_account_id: string | null
          disposal_gain_account_id: string | null
          disposal_loss_account_id: string | null
          enforce_credit_limit: boolean
          fx_gain_account_id: string | null
          fx_loss_account_id: string | null
          gain_on_disposal_account_id: string | null
          grni_clearing_account_id: string | null
          id: string
          inventory_account_id: string | null
          inventory_adjustment_approval_threshold: number
          inventory_asset_account_id: string | null
          invoice_approval_threshold: number | null
          invoice_approval_tiers: Json | null
          invoice_approver_ids: string[] | null
          loss_on_disposal_account_id: string | null
          payroll_clearing_account_id: string | null
          petty_cash_account_id: string | null
          purchase_price_variance_account_id: string | null
          retained_earnings_account_id: string | null
          sales_account_id: string | null
          tax_payable_account_id: string | null
          tenant_id: string
          updated_at: string
          vat_input_receivable_account_id: string | null
          vat_output_payable_account_id: string | null
          wages_expense_account_id: string | null
        }
        Insert: {
          accum_depreciation_account_id?: string | null
          accumulated_depreciation_account_id?: string | null
          ap_account_id?: string | null
          ar_account_id?: string | null
          bank_account_id?: string | null
          bank_import_amount_ceiling?: number
          bank_import_posting_mode?: string
          bank_import_unrecognized_deposit_account_id?: string | null
          bank_import_unrecognized_payment_account_id?: string | null
          cogs_account_id?: string | null
          created_at?: string
          credit_note_approval_threshold?: number | null
          customer_advance_account_id?: string | null
          depreciation_expense_account_id?: string | null
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
          enforce_credit_limit?: boolean
          fx_gain_account_id?: string | null
          fx_loss_account_id?: string | null
          gain_on_disposal_account_id?: string | null
          grni_clearing_account_id?: string | null
          id?: string
          inventory_account_id?: string | null
          inventory_adjustment_approval_threshold?: number
          inventory_asset_account_id?: string | null
          invoice_approval_threshold?: number | null
          invoice_approval_tiers?: Json | null
          invoice_approver_ids?: string[] | null
          loss_on_disposal_account_id?: string | null
          payroll_clearing_account_id?: string | null
          petty_cash_account_id?: string | null
          purchase_price_variance_account_id?: string | null
          retained_earnings_account_id?: string | null
          sales_account_id?: string | null
          tax_payable_account_id?: string | null
          tenant_id: string
          updated_at?: string
          vat_input_receivable_account_id?: string | null
          vat_output_payable_account_id?: string | null
          wages_expense_account_id?: string | null
        }
        Update: {
          accum_depreciation_account_id?: string | null
          accumulated_depreciation_account_id?: string | null
          ap_account_id?: string | null
          ar_account_id?: string | null
          bank_account_id?: string | null
          bank_import_amount_ceiling?: number
          bank_import_posting_mode?: string
          bank_import_unrecognized_deposit_account_id?: string | null
          bank_import_unrecognized_payment_account_id?: string | null
          cogs_account_id?: string | null
          created_at?: string
          credit_note_approval_threshold?: number | null
          customer_advance_account_id?: string | null
          depreciation_expense_account_id?: string | null
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
          enforce_credit_limit?: boolean
          fx_gain_account_id?: string | null
          fx_loss_account_id?: string | null
          gain_on_disposal_account_id?: string | null
          grni_clearing_account_id?: string | null
          id?: string
          inventory_account_id?: string | null
          inventory_adjustment_approval_threshold?: number
          inventory_asset_account_id?: string | null
          invoice_approval_threshold?: number | null
          invoice_approval_tiers?: Json | null
          invoice_approver_ids?: string[] | null
          loss_on_disposal_account_id?: string | null
          payroll_clearing_account_id?: string | null
          petty_cash_account_id?: string | null
          purchase_price_variance_account_id?: string | null
          retained_earnings_account_id?: string | null
          sales_account_id?: string | null
          tax_payable_account_id?: string | null
          tenant_id?: string
          updated_at?: string
          vat_input_receivable_account_id?: string | null
          vat_output_payable_account_id?: string | null
          wages_expense_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_settings_accum_depreciation_account_id_fkey"
            columns: ["accum_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_accumulated_depreciation_account_id_fkey"
            columns: ["accumulated_depreciation_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "account_settings_bank_import_unrecognized_deposit_account__fkey"
            columns: ["bank_import_unrecognized_deposit_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_bank_import_unrecognized_payment_account__fkey"
            columns: ["bank_import_unrecognized_payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_cogs_account_id_fkey"
            columns: ["cogs_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_customer_advance_account_id_fkey"
            columns: ["customer_advance_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_depreciation_expense_account_id_fkey"
            columns: ["depreciation_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_disposal_gain_account_id_fkey"
            columns: ["disposal_gain_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_disposal_loss_account_id_fkey"
            columns: ["disposal_loss_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_fx_gain_account_id_fkey"
            columns: ["fx_gain_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_fx_loss_account_id_fkey"
            columns: ["fx_loss_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_gain_on_disposal_account_id_fkey"
            columns: ["gain_on_disposal_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_grni_clearing_account_id_fkey"
            columns: ["grni_clearing_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_inventory_asset_account_id_fkey"
            columns: ["inventory_asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_loss_on_disposal_account_id_fkey"
            columns: ["loss_on_disposal_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_payroll_clearing_account_id_fkey"
            columns: ["payroll_clearing_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_petty_cash_account_id_fkey"
            columns: ["petty_cash_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_purchase_price_variance_account_id_fkey"
            columns: ["purchase_price_variance_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_retained_earnings_account_id_fkey"
            columns: ["retained_earnings_account_id"]
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
          {
            foreignKeyName: "account_settings_vat_input_receivable_account_id_fkey"
            columns: ["vat_input_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_vat_output_payable_account_id_fkey"
            columns: ["vat_output_payable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_settings_wages_expense_account_id_fkey"
            columns: ["wages_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
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
          account_level: number
          account_name: string
          account_path: string
          account_subtype: string | null
          account_type: string
          category_id: string | null
          control_account_type: string
          created_at: string
          created_from: string | null
          id: string
          is_active: boolean
          is_contra: boolean
          is_control_account: boolean
          is_locked: boolean
          is_postable: boolean
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
          account_level?: number
          account_name: string
          account_path: string
          account_subtype?: string | null
          account_type: string
          category_id?: string | null
          control_account_type?: string
          created_at?: string
          created_from?: string | null
          id?: string
          is_active?: boolean
          is_contra?: boolean
          is_control_account?: boolean
          is_locked?: boolean
          is_postable?: boolean
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
          account_level?: number
          account_name?: string
          account_path?: string
          account_subtype?: string | null
          account_type?: string
          category_id?: string | null
          control_account_type?: string
          created_at?: string
          created_from?: string | null
          id?: string
          is_active?: boolean
          is_contra?: boolean
          is_control_account?: boolean
          is_locked?: boolean
          is_postable?: boolean
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
      ap_transactions: {
        Row: {
          amount: number
          ap_account_id: string | null
          created_at: string
          document_id: string | null
          document_ref: string | null
          due_date: string | null
          id: string
          journal_entry_id: string | null
          journal_line_id: string | null
          notes: string | null
          outstanding_amount: number
          related_transaction_id: string | null
          status: Database["public"]["Enums"]["ap_transaction_status"]
          tenant_id: string
          transaction_date: string
          transaction_type: Database["public"]["Enums"]["ap_transaction_type"]
          updated_at: string
          vendor_id: string
        }
        Insert: {
          amount?: number
          ap_account_id?: string | null
          created_at?: string
          document_id?: string | null
          document_ref?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          journal_line_id?: string | null
          notes?: string | null
          outstanding_amount?: number
          related_transaction_id?: string | null
          status?: Database["public"]["Enums"]["ap_transaction_status"]
          tenant_id: string
          transaction_date: string
          transaction_type: Database["public"]["Enums"]["ap_transaction_type"]
          updated_at?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          ap_account_id?: string | null
          created_at?: string
          document_id?: string | null
          document_ref?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          journal_line_id?: string | null
          notes?: string | null
          outstanding_amount?: number
          related_transaction_id?: string | null
          status?: Database["public"]["Enums"]["ap_transaction_status"]
          tenant_id?: string
          transaction_date?: string
          transaction_type?: Database["public"]["Enums"]["ap_transaction_type"]
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_transactions_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_transactions_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "ap_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_transactions_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      apit_brackets: {
        Row: {
          annual_amount_up_to: number | null
          bracket_order: number
          created_at: string
          id: string
          rate: number
          schedule_id: string
        }
        Insert: {
          annual_amount_up_to?: number | null
          bracket_order: number
          created_at?: string
          id?: string
          rate: number
          schedule_id: string
        }
        Update: {
          annual_amount_up_to?: number | null
          bracket_order?: number
          created_at?: string
          id?: string
          rate?: number
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "apit_brackets_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "apit_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      apit_schedules: {
        Row: {
          annual_relief: number
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          annual_relief: number
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          tenant_id?: string | null
        }
        Update: {
          annual_relief?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apit_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_credit_note_items: {
        Row: {
          account_id: string | null
          credit_note_id: string
          description: string | null
          discount_amount: number
          id: string
          inventory_item_id: string | null
          is_tax_inclusive: boolean
          product_id: string | null
          quantity: number
          restock: boolean
          sort_order: number
          tax_code_id: string | null
          tax_group_id: string | null
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          credit_note_id: string
          description?: string | null
          discount_amount?: number
          id?: string
          inventory_item_id?: string | null
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          restock?: boolean
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          credit_note_id?: string
          description?: string | null
          discount_amount?: number
          id?: string
          inventory_item_id?: string | null
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          restock?: boolean
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "ar_credit_note_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_note_items_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_note_items_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_note_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_note_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_note_items_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_credit_notes: {
        Row: {
          amount: number
          approval_note: string | null
          approval_status: string
          approvals_count: number
          approved_at: string | null
          approved_by: string | null
          ar_account_id: string | null
          created_at: string
          created_by: string | null
          credit_date: string
          credit_note_number: string
          currency: string
          customer_id: string
          exchange_rate: number
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          posted_at: string | null
          posted_by: string | null
          reason: string | null
          required_approvals: number
          revenue_account_id: string | null
          reversal_journal_entry_id: string | null
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          approval_note?: string | null
          approval_status?: string
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          ar_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_date?: string
          credit_note_number: string
          currency?: string
          customer_id: string
          exchange_rate?: number
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reason?: string | null
          required_approvals?: number
          revenue_account_id?: string | null
          reversal_journal_entry_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          approval_note?: string | null
          approval_status?: string
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          ar_account_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_date?: string
          credit_note_number?: string
          currency?: string
          customer_id?: string
          exchange_rate?: number
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reason?: string | null
          required_approvals?: number
          revenue_account_id?: string | null
          reversal_journal_entry_id?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_credit_notes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
            foreignKeyName: "ar_credit_notes_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
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
            foreignKeyName: "ar_credit_notes_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_credit_notes_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_fx_revaluations: {
        Row: {
          base_at_invoice: number
          base_at_period_end: number
          created_at: string
          created_by: string | null
          currency: string
          fx_delta: number
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          open_amount_fc: number
          period_end: string
          rate_invoice: number
          rate_period_end: number
          reversal_journal_entry_id: string | null
          tenant_id: string
        }
        Insert: {
          base_at_invoice: number
          base_at_period_end: number
          created_at?: string
          created_by?: string | null
          currency: string
          fx_delta: number
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          open_amount_fc: number
          period_end: string
          rate_invoice: number
          rate_period_end: number
          reversal_journal_entry_id?: string | null
          tenant_id: string
        }
        Update: {
          base_at_invoice?: number
          base_at_period_end?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          fx_delta?: number
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          open_amount_fc?: number
          period_end?: string
          rate_invoice?: number
          rate_period_end?: number
          reversal_journal_entry_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_fx_revaluations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_fx_revaluations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_fx_revaluations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_fx_revaluations_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_fx_revaluations_tenant_id_fkey"
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
      ar_transactions: {
        Row: {
          amount: number
          ar_account_id: string | null
          created_at: string
          customer_id: string
          document_id: string | null
          document_ref: string | null
          due_date: string | null
          id: string
          journal_entry_id: string | null
          journal_line_id: string | null
          notes: string | null
          outstanding_amount: number
          related_transaction_id: string | null
          status: Database["public"]["Enums"]["ar_transaction_status"]
          tenant_id: string
          transaction_date: string
          transaction_type: Database["public"]["Enums"]["ar_transaction_type"]
          updated_at: string
        }
        Insert: {
          amount?: number
          ar_account_id?: string | null
          created_at?: string
          customer_id: string
          document_id?: string | null
          document_ref?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          journal_line_id?: string | null
          notes?: string | null
          outstanding_amount?: number
          related_transaction_id?: string | null
          status?: Database["public"]["Enums"]["ar_transaction_status"]
          tenant_id: string
          transaction_date: string
          transaction_type: Database["public"]["Enums"]["ar_transaction_type"]
          updated_at?: string
        }
        Update: {
          amount?: number
          ar_account_id?: string | null
          created_at?: string
          customer_id?: string
          document_id?: string | null
          document_ref?: string | null
          due_date?: string | null
          id?: string
          journal_entry_id?: string | null
          journal_line_id?: string | null
          notes?: string | null
          outstanding_amount?: number
          related_transaction_id?: string | null
          status?: Database["public"]["Enums"]["ar_transaction_status"]
          tenant_id?: string
          transaction_date?: string
          transaction_type?: Database["public"]["Enums"]["ar_transaction_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_transactions_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_transactions_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "ar_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_order_lines: {
        Row: {
          assembly_order_id: string
          component_item_id: string
          created_at: string
          id: string
          qty_required: number
          tenant_id: string
          total_cost: number
          unit_cost: number
        }
        Insert: {
          assembly_order_id: string
          component_item_id: string
          created_at?: string
          id?: string
          qty_required: number
          tenant_id: string
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          assembly_order_id?: string
          component_item_id?: string
          created_at?: string
          id?: string
          qty_required?: number
          tenant_id?: string
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "assembly_order_lines_assembly_order_id_fkey"
            columns: ["assembly_order_id"]
            isOneToOne: false
            referencedRelation: "assembly_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_order_lines_component_item_id_fkey"
            columns: ["component_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_order_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assembly_orders: {
        Row: {
          ao_date: string
          ao_number: string
          bom_id: string
          component_cost: number
          created_at: string
          fg_item_id: string
          id: string
          journal_entry_id: string | null
          labor_cost: number
          notes: string | null
          output_qty: number
          overhead_cost: number
          posted_at: string | null
          posted_by: string | null
          status: string
          tenant_id: string
          total_cost: number
          unit_cost: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          ao_date?: string
          ao_number: string
          bom_id: string
          component_cost?: number
          created_at?: string
          fg_item_id: string
          id?: string
          journal_entry_id?: string | null
          labor_cost?: number
          notes?: string | null
          output_qty: number
          overhead_cost?: number
          posted_at?: string | null
          posted_by?: string | null
          status?: string
          tenant_id: string
          total_cost?: number
          unit_cost?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          ao_date?: string
          ao_number?: string
          bom_id?: string
          component_cost?: number
          created_at?: string
          fg_item_id?: string
          id?: string
          journal_entry_id?: string | null
          labor_cost?: number
          notes?: string | null
          output_qty?: number
          overhead_cost?: number
          posted_at?: string | null
          posted_by?: string | null
          status?: string
          tenant_id?: string
          total_cost?: number
          unit_cost?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assembly_orders_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_orders_fg_item_id_fkey"
            columns: ["fg_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assembly_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      attendance_daily: {
        Row: {
          batch_id: string | null
          created_at: string
          early_leave_minutes: number
          employee_id: string
          first_in: string | null
          holiday_ot_hours: number
          id: string
          is_rest_day: boolean
          last_out: string | null
          late_minutes: number
          notes: string | null
          ot_hours: number
          shift_id: string | null
          source: string
          status: string
          tenant_id: string
          updated_at: string
          work_date: string
          worked_hours: number
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          early_leave_minutes?: number
          employee_id: string
          first_in?: string | null
          holiday_ot_hours?: number
          id?: string
          is_rest_day?: boolean
          last_out?: string | null
          late_minutes?: number
          notes?: string | null
          ot_hours?: number
          shift_id?: string | null
          source?: string
          status?: string
          tenant_id: string
          updated_at?: string
          work_date: string
          worked_hours?: number
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          early_leave_minutes?: number
          employee_id?: string
          first_in?: string | null
          holiday_ot_hours?: number
          id?: string
          is_rest_day?: boolean
          last_out?: string | null
          late_minutes?: number
          notes?: string | null
          ot_hours?: number
          shift_id?: string | null
          source?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          work_date?: string
          worked_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_daily_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "attendance_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_daily_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_daily_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_daily_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_device_profiles: {
        Row: {
          column_mapping: Json
          created_at: string
          date_order: string
          datetime_format: string | null
          debounce_seconds: number
          direction_mode: string
          file_format: string
          has_separate_date_time: boolean
          id: string
          in_values: string[] | null
          name: string
          out_values: string[] | null
          tenant_id: string
        }
        Insert: {
          column_mapping?: Json
          created_at?: string
          date_order?: string
          datetime_format?: string | null
          debounce_seconds?: number
          direction_mode?: string
          file_format?: string
          has_separate_date_time?: boolean
          id?: string
          in_values?: string[] | null
          name: string
          out_values?: string[] | null
          tenant_id: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          date_order?: string
          datetime_format?: string | null
          debounce_seconds?: number
          direction_mode?: string
          file_format?: string
          has_separate_date_time?: boolean
          id?: string
          in_values?: string[] | null
          name?: string
          out_values?: string[] | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_device_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_import_batches: {
        Row: {
          created_at: string
          device_profile_id: string | null
          file_name: string
          id: string
          imported_by: string | null
          matched_rows: number
          period_end: string | null
          period_start: string | null
          status: string
          tenant_id: string
          total_rows: number
          unmatched_rows: number
        }
        Insert: {
          created_at?: string
          device_profile_id?: string | null
          file_name: string
          id?: string
          imported_by?: string | null
          matched_rows?: number
          period_end?: string | null
          period_start?: string | null
          status?: string
          tenant_id: string
          total_rows?: number
          unmatched_rows?: number
        }
        Update: {
          created_at?: string
          device_profile_id?: string | null
          file_name?: string
          id?: string
          imported_by?: string | null
          matched_rows?: number
          period_end?: string | null
          period_start?: string | null
          status?: string
          tenant_id?: string
          total_rows?: number
          unmatched_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "attendance_import_batches_device_profile_id_fkey"
            columns: ["device_profile_id"]
            isOneToOne: false
            referencedRelation: "attendance_device_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_import_batches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_import_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_punches: {
        Row: {
          batch_id: string
          created_at: string
          direction: string
          employee_id: string | null
          id: string
          is_matched: boolean
          punch_at: string
          raw_device_id: string
          raw_row: Json | null
          tenant_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          direction?: string
          employee_id?: string | null
          id?: string
          is_matched?: boolean
          punch_at: string
          raw_device_id: string
          raw_row?: Json | null
          tenant_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          direction?: string
          employee_id?: string | null
          id?: string
          is_matched?: boolean
          punch_at?: string
          raw_device_id?: string
          raw_row?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_punches_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "attendance_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_punches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_date: string
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          created_by: string | null
          device_id: string | null
          employee_id: string
          entry_source: string
          id: string
          leave_request_id: string | null
          notes: string | null
          overtime_hours: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attendance_date: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          employee_id: string
          entry_source?: string
          id?: string
          leave_request_id?: string | null
          notes?: string | null
          overtime_hours?: number
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attendance_date?: string
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          employee_id?: string
          entry_source?: string
          id?: string
          leave_request_id?: string | null
          notes?: string | null
          overtime_hours?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_leave_request_id_fkey"
            columns: ["leave_request_id"]
            isOneToOne: false
            referencedRelation: "leave_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_tenant_id_fkey"
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
      bank_categorization_rules: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          expected_side: string
          id: string
          is_active: boolean
          match_field: string
          match_type: string
          match_value: string
          priority: number
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          expected_side?: string
          id?: string
          is_active?: boolean
          match_field?: string
          match_type?: string
          match_value: string
          priority?: number
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          expected_side?: string
          id?: string
          is_active?: boolean
          match_field?: string
          match_type?: string
          match_value?: string
          priority?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_categorization_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_categorization_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_categorization_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_category_account_map: {
        Row: {
          account_id: string
          canonical_category: string
          created_at: string
          created_by: string | null
          expected_side: string
          id: string
          is_active: boolean
          tenant_id: string
        }
        Insert: {
          account_id: string
          canonical_category: string
          created_at?: string
          created_by?: string | null
          expected_side?: string
          id?: string
          is_active?: boolean
          tenant_id: string
        }
        Update: {
          account_id?: string
          canonical_category?: string
          created_at?: string
          created_by?: string | null
          expected_side?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_category_account_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_category_account_map_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_category_account_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_category_canonical_map: {
        Row: {
          canonical_category: string
          created_at: string
          created_by: string | null
          id: string
          raw_variant: string
          tenant_id: string | null
        }
        Insert: {
          canonical_category: string
          created_at?: string
          created_by?: string | null
          id?: string
          raw_variant: string
          tenant_id?: string | null
        }
        Update: {
          canonical_category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          raw_variant?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_category_canonical_map_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_category_canonical_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      bank_import_chart_template: {
        Row: {
          account_code: string
          account_name: string
          account_subtype: string | null
          account_type: string
          canonical_category: string | null
          expected_side: string
          parent_code: string | null
          reversal_category: string | null
          sort_order: number
        }
        Insert: {
          account_code: string
          account_name: string
          account_subtype?: string | null
          account_type: string
          canonical_category?: string | null
          expected_side?: string
          parent_code?: string | null
          reversal_category?: string | null
          sort_order: number
        }
        Update: {
          account_code?: string
          account_name?: string
          account_subtype?: string | null
          account_type?: string
          canonical_category?: string | null
          expected_side?: string
          parent_code?: string | null
          reversal_category?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      bank_import_derived_accounts: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          derive_key: string
          id: string
          side: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          derive_key: string
          id?: string
          side: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          derive_key?: string
          id?: string
          side?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_import_derived_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_import_derived_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_import_derived_accounts_tenant_id_fkey"
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
      bank_statement_batch_periods: {
        Row: {
          bank_account_id: string
          batch_id: string
          id: string
          is_active: boolean
          period_month: number
          period_year: number
          tenant_id: string
        }
        Insert: {
          bank_account_id: string
          batch_id: string
          id?: string
          is_active?: boolean
          period_month: number
          period_year: number
          tenant_id: string
        }
        Update: {
          bank_account_id?: string
          batch_id?: string
          id?: string
          is_active?: boolean
          period_month?: number
          period_year?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_batch_periods_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_batch_periods_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_batch_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_batches: {
        Row: {
          bank_account_id: string
          created_at: string
          created_by: string
          engine_version: string | null
          error_message: string | null
          file_name: string | null
          id: string
          posted_at: string | null
          posting_mode: string | null
          row_count: number
          sheet_periods: Json
          status: string
          storage_path: string
          summary: Json | null
          tenant_id: string
          total_credit: number
          total_debit: number
          void_kind: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          bank_account_id: string
          created_at?: string
          created_by: string
          engine_version?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          posted_at?: string | null
          posting_mode?: string | null
          row_count?: number
          sheet_periods?: Json
          status?: string
          storage_path: string
          summary?: Json | null
          tenant_id: string
          total_credit?: number
          total_debit?: number
          void_kind?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          bank_account_id?: string
          created_at?: string
          created_by?: string
          engine_version?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          posted_at?: string | null
          posting_mode?: string | null
          row_count?: number
          sheet_periods?: Json
          status?: string
          storage_path?: string
          summary?: Json | null
          tenant_id?: string
          total_credit?: number
          total_debit?: number
          void_kind?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_batches_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_lines: {
        Row: {
          balance: number | null
          bank_fee: number | null
          batch_id: string
          block_reason: string | null
          canonical_category: string | null
          created_at: string
          credit: number
          debit: number
          description: string
          engine_version: string | null
          id: string
          is_excluded: boolean
          journal_entry_id: string | null
          name: string
          needs_reclassification: boolean
          period_month: number
          period_year: number
          raw_account_type: string
          raw_date: string | null
          reclass_journal_entry_id: string | null
          resolution_tier: number | null
          resolved_account_id: string | null
          resolved_by_map_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_index: number
          sheet_name: string
          suggestions: Json
          suspense_reason: string | null
          tenant_id: string
          txn_date: string | null
          validation_flags: Json
          voucher_no: string
        }
        Insert: {
          balance?: number | null
          bank_fee?: number | null
          batch_id: string
          block_reason?: string | null
          canonical_category?: string | null
          created_at?: string
          credit?: number
          debit?: number
          description?: string
          engine_version?: string | null
          id?: string
          is_excluded?: boolean
          journal_entry_id?: string | null
          name?: string
          needs_reclassification?: boolean
          period_month: number
          period_year: number
          raw_account_type?: string
          raw_date?: string | null
          reclass_journal_entry_id?: string | null
          resolution_tier?: number | null
          resolved_account_id?: string | null
          resolved_by_map_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_index: number
          sheet_name: string
          suggestions?: Json
          suspense_reason?: string | null
          tenant_id: string
          txn_date?: string | null
          validation_flags?: Json
          voucher_no?: string
        }
        Update: {
          balance?: number | null
          bank_fee?: number | null
          batch_id?: string
          block_reason?: string | null
          canonical_category?: string | null
          created_at?: string
          credit?: number
          debit?: number
          description?: string
          engine_version?: string | null
          id?: string
          is_excluded?: boolean
          journal_entry_id?: string | null
          name?: string
          needs_reclassification?: boolean
          period_month?: number
          period_year?: number
          raw_account_type?: string
          raw_date?: string | null
          reclass_journal_entry_id?: string | null
          resolution_tier?: number | null
          resolved_account_id?: string | null
          resolved_by_map_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          row_index?: number
          sheet_name?: string
          suggestions?: Json
          suspense_reason?: string | null
          tenant_id?: string
          txn_date?: string | null
          validation_flags?: Json
          voucher_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "bank_statement_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_reclass_journal_entry_id_fkey"
            columns: ["reclass_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_resolved_account_id_fkey"
            columns: ["resolved_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_payment_allocations: {
        Row: {
          amount_applied: number
          bill_id: string
          created_at: string
          id: string
          payment_id: string
          tenant_id: string
        }
        Insert: {
          amount_applied: number
          bill_id: string
          created_at?: string
          id?: string
          payment_id: string
          tenant_id: string
        }
        Update: {
          amount_applied?: number
          bill_id?: string
          created_at?: string
          id?: string
          payment_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_payment_allocations_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "bill_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payment_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_payments: {
        Row: {
          amount: number
          ap_account_id: string
          bank_account_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          payment_date: string
          payment_nature: string | null
          reference: string | null
          status: string
          tenant_id: string
          vendor_id: string
          wht_amount: number
          wht_certificate_no: string | null
          wht_override_reason: string | null
          wht_rule_id: string | null
        }
        Insert: {
          amount: number
          ap_account_id: string
          bank_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_nature?: string | null
          reference?: string | null
          status?: string
          tenant_id: string
          vendor_id: string
          wht_amount?: number
          wht_certificate_no?: string | null
          wht_override_reason?: string | null
          wht_rule_id?: string | null
        }
        Update: {
          amount?: number
          ap_account_id?: string
          bank_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_nature?: string | null
          reference?: string | null
          status?: string
          tenant_id?: string
          vendor_id?: string
          wht_amount?: number
          wht_certificate_no?: string | null
          wht_override_reason?: string | null
          wht_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_payments_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_payments_wht_rule_id_fkey"
            columns: ["wht_rule_id"]
            isOneToOne: false
            referencedRelation: "wht_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_components: {
        Row: {
          bom_id: string
          component_item_id: string
          created_at: string
          id: string
          notes: string | null
          qty_per_output: number
          scrap_pct: number
          tenant_id: string
        }
        Insert: {
          bom_id: string
          component_item_id: string
          created_at?: string
          id?: string
          notes?: string | null
          qty_per_output: number
          scrap_pct?: number
          tenant_id: string
        }
        Update: {
          bom_id?: string
          component_item_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          qty_per_output?: number
          scrap_pct?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bom_components_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_components_component_item_id_fkey"
            columns: ["component_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_components_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      boms: {
        Row: {
          bom_code: string
          created_at: string
          fg_item_id: string
          id: string
          is_active: boolean
          labor_cost_per_unit: number
          notes: string | null
          output_qty: number
          overhead_cost_per_unit: number
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          bom_code: string
          created_at?: string
          fg_item_id: string
          id?: string
          is_active?: boolean
          labor_cost_per_unit?: number
          notes?: string | null
          output_qty?: number
          overhead_cost_per_unit?: number
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          bom_code?: string
          created_at?: string
          fg_item_id?: string
          id?: string
          is_active?: boolean
          labor_cost_per_unit?: number
          notes?: string | null
          output_qty?: number
          overhead_cost_per_unit?: number
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "boms_fg_item_id_fkey"
            columns: ["fg_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_provisions: {
        Row: {
          created_at: string
          created_by: string | null
          employee_count: number
          id: string
          journal_entry_id: string | null
          period: string
          tenant_id: string
          total_amount: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_count: number
          id?: string
          journal_entry_id?: string | null
          period: string
          tenant_id: string
          total_amount: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_count?: number
          id?: string
          journal_entry_id?: string | null
          period?: string
          tenant_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "bonus_provisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_provisions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonus_provisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bonus_settings: {
        Row: {
          bonus_months: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          bonus_months?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          bonus_months?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonus_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      client_visits: {
        Row: {
          check_in_address: string | null
          check_in_latitude: number | null
          check_in_longitude: number | null
          check_in_time: string
          check_out_address: string | null
          check_out_latitude: number | null
          check_out_longitude: number | null
          check_out_time: string | null
          client_name: string
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
          visit_date: string
        }
        Insert: {
          check_in_address?: string | null
          check_in_latitude?: number | null
          check_in_longitude?: number | null
          check_in_time?: string
          check_out_address?: string | null
          check_out_latitude?: number | null
          check_out_longitude?: number | null
          check_out_time?: string | null
          client_name: string
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          visit_date?: string
        }
        Update: {
          check_in_address?: string | null
          check_in_latitude?: number | null
          check_in_longitude?: number | null
          check_in_time?: string
          check_out_address?: string | null
          check_out_latitude?: number | null
          check_out_longitude?: number | null
          check_out_time?: string | null
          client_name?: string
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_visits_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      company_profiles: {
        Row: {
          address_line2: string | null
          bank_account_name: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          bank_swift: string | null
          city: string | null
          created_at: string
          email: string | null
          id: string
          invoice_footer_note: string
          invoice_terms: string | null
          is_vat_registered: boolean
          postal_code: string | null
          svat_registration_no: string | null
          tenant_id: string
          trading_name: string | null
          updated_at: string
          vat_registration_no: string | null
          website: string | null
        }
        Insert: {
          address_line2?: string | null
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_footer_note?: string
          invoice_terms?: string | null
          is_vat_registered?: boolean
          postal_code?: string | null
          svat_registration_no?: string | null
          tenant_id: string
          trading_name?: string | null
          updated_at?: string
          vat_registration_no?: string | null
          website?: string | null
        }
        Update: {
          address_line2?: string | null
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bank_swift?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_footer_note?: string
          invoice_terms?: string | null
          is_vat_registered?: boolean
          postal_code?: string | null
          svat_registration_no?: string | null
          tenant_id?: string
          trading_name?: string | null
          updated_at?: string
          vat_registration_no?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
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
      credit_note_approval_history: {
        Row: {
          action: string
          actor_id: string | null
          amount_base: number | null
          created_at: string
          credit_note_id: string
          id: string
          note: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          amount_base?: number | null
          created_at?: string
          credit_note_id: string
          id?: string
          note?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          amount_base?: number | null
          created_at?: string
          credit_note_id?: string
          id?: string
          note?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_approval_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_approval_history_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "ar_credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_approval_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_counters: {
        Row: {
          last_number: number
          tenant_id: string
          year: number
        }
        Insert: {
          last_number?: number
          tenant_id: string
          year: number
        }
        Update: {
          last_number?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_accounts: {
        Row: {
          ar_account_id: string | null
          created_at: string
          credit_limit: number
          credit_terms_days: number
          current_balance: number
          customer_id: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ar_account_id?: string | null
          created_at?: string
          credit_limit?: number
          credit_terms_days?: number
          current_balance?: number
          customer_id: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ar_account_id?: string | null
          created_at?: string
          credit_limit?: number
          credit_terms_days?: number
          current_balance?: number
          customer_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_accounts_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accounts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_accounts_tenant_id_fkey"
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
          address_line2: string | null
          address_type: string
          city: string | null
          country: string | null
          created_at: string
          customer_id: string
          id: string
          is_primary: boolean
          postal_code: string | null
          state_province: string | null
          tenant_id: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          address_type?: string
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_primary?: boolean
          postal_code?: string | null
          state_province?: string | null
          tenant_id?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          address_type?: string
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_primary?: boolean
          postal_code?: string | null
          state_province?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_deposits: {
        Row: {
          advance_account_id: string | null
          amount: number
          applied_amount: number
          bank_account_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deposit_date: string
          id: string
          journal_entry_id: string | null
          notes: string | null
          payment_method: string | null
          reference: string | null
          source_payment_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          advance_account_id?: string | null
          amount: number
          applied_amount?: number
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deposit_date?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_method?: string | null
          reference?: string | null
          source_payment_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          advance_account_id?: string | null
          amount?: number
          applied_amount?: number
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deposit_date?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_method?: string | null
          reference?: string | null
          source_payment_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_deposits_advance_account_id_fkey"
            columns: ["advance_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payments_received"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_deposits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          ar_account_id: string | null
          contact_person: string | null
          created_at: string
          credit_hold: boolean
          credit_limit: number
          currency: string
          customer_code: string | null
          customer_type: string
          default_tax_id: string | null
          email: string | null
          id: string
          is_tax_exempt: boolean
          legal_name: string | null
          mobile: string | null
          name: string
          notes: string | null
          opening_balance: number
          payment_terms: string
          phone: string | null
          registration_date: string | null
          revenue_account_id: string | null
          status: string
          tenant_id: string
          tin: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
          withholds_tax: boolean
        }
        Insert: {
          address?: string | null
          ar_account_id?: string | null
          contact_person?: string | null
          created_at?: string
          credit_hold?: boolean
          credit_limit?: number
          currency?: string
          customer_code?: string | null
          customer_type?: string
          default_tax_id?: string | null
          email?: string | null
          id?: string
          is_tax_exempt?: boolean
          legal_name?: string | null
          mobile?: string | null
          name: string
          notes?: string | null
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          registration_date?: string | null
          revenue_account_id?: string | null
          status?: string
          tenant_id: string
          tin?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
          withholds_tax?: boolean
        }
        Update: {
          address?: string | null
          ar_account_id?: string | null
          contact_person?: string | null
          created_at?: string
          credit_hold?: boolean
          credit_limit?: number
          currency?: string
          customer_code?: string | null
          customer_type?: string
          default_tax_id?: string | null
          email?: string | null
          id?: string
          is_tax_exempt?: boolean
          legal_name?: string | null
          mobile?: string | null
          name?: string
          notes?: string | null
          opening_balance?: number
          payment_terms?: string
          phone?: string | null
          registration_date?: string | null
          revenue_account_id?: string | null
          status?: string
          tenant_id?: string
          tin?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
          withholds_tax?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customers_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_default_tax_id_fkey"
            columns: ["default_tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
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
      deposit_applications: {
        Row: {
          amount: number
          applied_date: string
          created_at: string
          deposit_id: string
          id: string
          invoice_id: string
          journal_entry_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          applied_date?: string
          created_at?: string
          deposit_id: string
          id?: string
          invoice_id: string
          journal_entry_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          applied_date?: string
          created_at?: string
          deposit_id?: string
          id?: string
          invoice_id?: string
          journal_entry_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposit_applications_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "customer_deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_applications_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_applications_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deposit_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_compensation: {
        Row: {
          basic_salary: number
          created_at: string
          created_by: string | null
          effective_from: string
          employee_id: string
          id: string
          is_current: boolean
          notes: string | null
          pay_frequency: string
          pay_rate: number
          tenant_id: string
        }
        Insert: {
          basic_salary?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          employee_id: string
          id?: string
          is_current?: boolean
          notes?: string | null
          pay_frequency?: string
          pay_rate?: number
          tenant_id: string
        }
        Update: {
          basic_salary?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          employee_id?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          pay_frequency?: string
          pay_rate?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_compensation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compensation_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_compensation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_loans: {
        Row: {
          balance: number
          created_at: string
          created_by: string | null
          description: string | null
          employee_id: string
          id: string
          monthly_installment: number
          principal: number
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          balance: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id: string
          id?: string
          monthly_installment: number
          principal: number
          start_date?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          employee_id?: string
          id?: string
          monthly_installment?: number
          principal?: number
          start_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_loans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_loans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_recurring_components: {
        Row: {
          amount: number
          component_type: string
          created_at: string
          employee_id: string
          id: string
          is_active: boolean
          label: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          component_type: string
          created_at?: string
          employee_id: string
          id?: string
          is_active?: boolean
          label: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          component_type?: string
          created_at?: string
          employee_id?: string
          id?: string
          is_active?: boolean
          label?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_recurring_components_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_recurring_components_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          bank_account_name: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          bik_monthly_value: number
          biometric_id: string | null
          city: string | null
          civil_status: string | null
          created_at: string
          date_of_birth: string | null
          department: string | null
          designation: string | null
          district: string | null
          email: string | null
          employee_number: string | null
          employment_type: string
          epf_number: string | null
          first_name: string
          gender: string | null
          hire_date: string | null
          id: string
          is_epf_applicable: boolean
          is_etf_applicable: boolean
          is_paye_applicable: boolean
          last_name: string
          leave_balance: number
          manager_id: string | null
          middle_name: string | null
          nic_number: string | null
          pay_rate: number | null
          pay_rate_type: string
          pay_schedule_id: string | null
          personal_phone: string | null
          photo_url: string | null
          postal_code: string | null
          salary: number | null
          shift_id: string | null
          sick_balance: number
          status: string
          tenant_id: string
          termination_date: string | null
          tin_number: string | null
          user_id: string | null
          vacation_balance: number
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bik_monthly_value?: number
          biometric_id?: string | null
          city?: string | null
          civil_status?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          designation?: string | null
          district?: string | null
          email?: string | null
          employee_number?: string | null
          employment_type?: string
          epf_number?: string | null
          first_name: string
          gender?: string | null
          hire_date?: string | null
          id?: string
          is_epf_applicable?: boolean
          is_etf_applicable?: boolean
          is_paye_applicable?: boolean
          last_name: string
          leave_balance?: number
          manager_id?: string | null
          middle_name?: string | null
          nic_number?: string | null
          pay_rate?: number | null
          pay_rate_type?: string
          pay_schedule_id?: string | null
          personal_phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          salary?: number | null
          shift_id?: string | null
          sick_balance?: number
          status?: string
          tenant_id: string
          termination_date?: string | null
          tin_number?: string | null
          user_id?: string | null
          vacation_balance?: number
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          bank_account_name?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bik_monthly_value?: number
          biometric_id?: string | null
          city?: string | null
          civil_status?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          designation?: string | null
          district?: string | null
          email?: string | null
          employee_number?: string | null
          employment_type?: string
          epf_number?: string | null
          first_name?: string
          gender?: string | null
          hire_date?: string | null
          id?: string
          is_epf_applicable?: boolean
          is_etf_applicable?: boolean
          is_paye_applicable?: boolean
          last_name?: string
          leave_balance?: number
          manager_id?: string | null
          middle_name?: string | null
          nic_number?: string | null
          pay_rate?: number | null
          pay_rate_type?: string
          pay_schedule_id?: string | null
          personal_phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          salary?: number | null
          shift_id?: string | null
          sick_balance?: number
          status?: string
          tenant_id?: string
          termination_date?: string | null
          tin_number?: string | null
          user_id?: string | null
          vacation_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_pay_schedule_id_fkey"
            columns: ["pay_schedule_id"]
            isOneToOne: false
            referencedRelation: "pay_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "work_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          created_at: string
          currency: string
          id: string
          rate_date: string
          rate_to_base: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          currency: string
          id?: string
          rate_date: string
          rate_to_base: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          rate_date?: string
          rate_to_base?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_tenant_id_fkey"
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
          journal_entry_id: string | null
          payment_account_id: string | null
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
          journal_entry_id?: string | null
          payment_account_id?: string | null
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
          journal_entry_id?: string | null
          payment_account_id?: string | null
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
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
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
      field_attendance_settings: {
        Row: {
          late_cutoff_enabled: boolean
          late_cutoff_time: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          late_cutoff_enabled?: boolean
          late_cutoff_time?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          late_cutoff_enabled?: boolean
          late_cutoff_time?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_attendance_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      field_visits: {
        Row: {
          attendance_status: string | null
          check_in_accuracy: number | null
          check_in_at: string
          check_in_lat: number | null
          check_in_lng: number | null
          check_out_accuracy: number | null
          check_out_at: string | null
          check_out_lat: number | null
          check_out_lng: number | null
          client_name: string | null
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          visit_date: string
        }
        Insert: {
          attendance_status?: string | null
          check_in_accuracy?: number | null
          check_in_at?: string
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_accuracy?: number | null
          check_out_at?: string | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          client_name?: string | null
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
          visit_date: string
        }
        Update: {
          attendance_status?: string | null
          check_in_accuracy?: number | null
          check_in_at?: string
          check_in_lat?: number | null
          check_in_lng?: number | null
          check_out_accuracy?: number | null
          check_out_at?: string | null
          check_out_lat?: number | null
          check_out_lng?: number | null
          client_name?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_visits_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_visits_tenant_id_fkey"
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
          disposal_gain_account_id: string | null
          disposal_loss_account_id: string | null
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
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
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
          disposal_gain_account_id?: string | null
          disposal_loss_account_id?: string | null
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
            foreignKeyName: "fixed_assets_disposal_gain_account_id_fkey"
            columns: ["disposal_gain_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_disposal_loss_account_id_fkey"
            columns: ["disposal_loss_account_id"]
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
      fs_line_accounts: {
        Row: {
          account_id: string
          created_at: string
          id: string
          line_id: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          line_id: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          line_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fs_line_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_line_accounts_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "fs_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_line_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fs_line_terms: {
        Row: {
          factor: number
          id: string
          line_id: string
          sort_order: number
          tenant_id: string
          term_line_id: string
        }
        Insert: {
          factor?: number
          id?: string
          line_id: string
          sort_order?: number
          tenant_id: string
          term_line_id: string
        }
        Update: {
          factor?: number
          id?: string
          line_id?: string
          sort_order?: number
          tenant_id?: string
          term_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fs_line_terms_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "fs_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_line_terms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_line_terms_term_line_id_fkey"
            columns: ["term_line_id"]
            isOneToOne: false
            referencedRelation: "fs_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      fs_lines: {
        Row: {
          created_at: string
          emphasis: string
          id: string
          is_margin_base: boolean
          label: string
          line_code: string
          line_type: string
          note_ref: string | null
          param_key: string | null
          parent_line_id: string | null
          show_margin: boolean
          sign: string
          sort_order: number
          statement_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          emphasis?: string
          id?: string
          is_margin_base?: boolean
          label: string
          line_code: string
          line_type: string
          note_ref?: string | null
          param_key?: string | null
          parent_line_id?: string | null
          show_margin?: boolean
          sign?: string
          sort_order: number
          statement_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          emphasis?: string
          id?: string
          is_margin_base?: boolean
          label?: string
          line_code?: string
          line_type?: string
          note_ref?: string | null
          param_key?: string | null
          parent_line_id?: string | null
          show_margin?: boolean
          sign?: string
          sort_order?: number
          statement_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fs_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "fs_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "fs_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fs_parameters: {
        Row: {
          created_at: string
          fiscal_period_id: string | null
          id: string
          key: string
          note: string | null
          tenant_id: string
          value: number
        }
        Insert: {
          created_at?: string
          fiscal_period_id?: string | null
          id?: string
          key: string
          note?: string | null
          tenant_id: string
          value: number
        }
        Update: {
          created_at?: string
          fiscal_period_id?: string | null
          id?: string
          key?: string
          note?: string | null
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fs_parameters_fiscal_period_id_fkey"
            columns: ["fiscal_period_id"]
            isOneToOne: false
            referencedRelation: "fiscal_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fs_parameters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fs_statements: {
        Row: {
          code: string
          created_at: string
          currency_caption: string
          footer_notes: string[]
          id: string
          name: string
          period_caption: string
          sort_order: number
          tenant_id: string
          title: string
        }
        Insert: {
          code: string
          created_at?: string
          currency_caption?: string
          footer_notes?: string[]
          id?: string
          name: string
          period_caption?: string
          sort_order?: number
          tenant_id: string
          title: string
        }
        Update: {
          code?: string
          created_at?: string
          currency_caption?: string
          footer_notes?: string[]
          id?: string
          name?: string
          period_caption?: string
          sort_order?: number
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "fs_statements_tenant_id_fkey"
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
      gratuity_provisions: {
        Row: {
          created_at: string
          created_by: string | null
          employee_count: number
          id: string
          journal_entry_id: string | null
          period: string
          tenant_id: string
          total_amount: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_count: number
          id?: string
          journal_entry_id?: string | null
          period: string
          tenant_id: string
          total_amount: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_count?: number
          id?: string
          journal_entry_id?: string | null
          period?: string
          tenant_id?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "gratuity_provisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gratuity_provisions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gratuity_provisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      gratuity_settings: {
        Row: {
          accrue_from_start: boolean
          eligibility_years: number
          months_per_year: number
          tenant_id: string
          terminal_tax_rate: number
          terminal_tax_relief: number
          updated_at: string
        }
        Insert: {
          accrue_from_start?: boolean
          eligibility_years?: number
          months_per_year?: number
          tenant_id: string
          terminal_tax_rate?: number
          terminal_tax_relief?: number
          updated_at?: string
        }
        Update: {
          accrue_from_start?: boolean
          eligibility_years?: number
          months_per_year?: number
          tenant_id?: string
          terminal_tax_rate?: number
          terminal_tax_relief?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gratuity_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      grn_lines: {
        Row: {
          created_at: string
          grn_id: string
          id: string
          is_tax_inclusive: boolean
          item_id: string
          line_total: number
          po_line_id: string | null
          qty_billed: number
          qty_received: number
          tax_amount_line: number
          tax_code_id: string | null
          tax_group_id: string | null
          tenant_id: string
          unit_cost: number
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          grn_id: string
          id?: string
          is_tax_inclusive?: boolean
          item_id: string
          line_total?: number
          po_line_id?: string | null
          qty_billed?: number
          qty_received: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          tenant_id: string
          unit_cost: number
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          grn_id?: string
          id?: string
          is_tax_inclusive?: boolean
          item_id?: string
          line_total?: number
          po_line_id?: string | null
          qty_billed?: number
          qty_received?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
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
            foreignKeyName: "grn_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grn_lines_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
      holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          is_recurring: boolean
          name: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          is_recurring?: boolean
          name: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          is_recurring?: boolean
          name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          default_purchase_tax_code_id: string | null
          default_purchase_tax_group_id: string | null
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
          default_purchase_tax_code_id?: string | null
          default_purchase_tax_group_id?: string | null
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
          default_purchase_tax_code_id?: string | null
          default_purchase_tax_group_id?: string | null
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
            foreignKeyName: "inventory_items_default_purchase_tax_code_id_fkey"
            columns: ["default_purchase_tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_default_purchase_tax_group_id_fkey"
            columns: ["default_purchase_tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
      invoice_approval_history: {
        Row: {
          action: string
          actor_id: string | null
          amount_base: number | null
          created_at: string
          id: string
          invoice_id: string
          note: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          amount_base?: number | null
          created_at?: string
          id?: string
          invoice_id: string
          note?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          amount_base?: number | null
          created_at?: string
          id?: string
          invoice_id?: string
          note?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_approval_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approval_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approval_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          file_name: string
          file_path: string
          file_url: string
          id: string
          invoice_id: string
          size_bytes: number | null
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_url: string
          id?: string
          invoice_id: string
          size_bytes?: number | null
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_url?: string
          id?: string
          invoice_id?: string
          size_bytes?: number | null
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_attachments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_emails: {
        Row: {
          created_at: string
          error: string | null
          id: string
          invoice_id: string
          opened_at: string | null
          provider_message_id: string | null
          recipient: string
          sent_by: string | null
          status: string
          subject: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id: string
          opened_at?: string | null
          provider_message_id?: string | null
          recipient: string
          sent_by?: string | null
          status?: string
          subject?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string
          opened_at?: string | null
          provider_message_id?: string | null
          recipient?: string
          sent_by?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_emails_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_emails_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_emails_tenant_id_fkey"
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
          discount_amount: number
          discount_percent: number
          id: string
          inventory_item_id: string | null
          invoice_id: string
          is_tax_inclusive: boolean
          product_id: string | null
          quantity: number
          tax_amount_line: number
          tax_code_id: string | null
          tax_group_id: string | null
          tax_id: string | null
          total: number
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          inventory_item_id?: string | null
          invoice_id: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          tax_id?: string | null
          total?: number
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          inventory_item_id?: string | null
          invoice_id?: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
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
            foreignKeyName: "invoice_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
      invoice_serial_register: {
        Row: {
          branch_code: string
          created_at: string
          id: string
          invoice_id: string | null
          mmm: string
          reason: string | null
          seq: number
          serial: string
          status: string
          tenant_id: string
          updated_at: string
          yy: number
        }
        Insert: {
          branch_code: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          mmm: string
          reason?: string | null
          seq: number
          serial: string
          status?: string
          tenant_id: string
          updated_at?: string
          yy: number
        }
        Update: {
          branch_code?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          mmm?: string
          reason?: string | null
          seq?: number
          serial?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          yy?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_serial_register_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_serial_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_serial_sequences: {
        Row: {
          branch_code: string
          created_at: string
          id: string
          last_seq: number
          mmm: string
          tenant_id: string
          updated_at: string
          yy: number
        }
        Insert: {
          branch_code: string
          created_at?: string
          id?: string
          last_seq?: number
          mmm: string
          tenant_id: string
          updated_at?: string
          yy: number
        }
        Update: {
          branch_code?: string
          created_at?: string
          id?: string
          last_seq?: number
          mmm?: string
          tenant_id?: string
          updated_at?: string
          yy?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_serial_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          approval_note: string | null
          approval_status: string
          approvals_count: number
          approved_at: string | null
          approved_by: string | null
          ar_account_id: string | null
          branch_code: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          date_of_supply: string | null
          discount_amount: number
          due_date: string | null
          email_recipient: string | null
          email_status: string | null
          exchange_rate: number
          id: string
          invoice_number: string
          issue_date: string
          journal_entry_id: string | null
          last_emailed_at: string | null
          mode_of_payment: string | null
          notes: string | null
          payment_terms: string
          place_of_supply: string | null
          posted_at: string | null
          posted_by: string | null
          posting_status: string
          required_approvals: number
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
          approval_note?: string | null
          approval_status?: string
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          ar_account_id?: string | null
          branch_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          date_of_supply?: string | null
          discount_amount?: number
          due_date?: string | null
          email_recipient?: string | null
          email_status?: string | null
          exchange_rate?: number
          id?: string
          invoice_number: string
          issue_date?: string
          journal_entry_id?: string | null
          last_emailed_at?: string | null
          mode_of_payment?: string | null
          notes?: string | null
          payment_terms?: string
          place_of_supply?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_status?: string
          required_approvals?: number
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
          approval_note?: string | null
          approval_status?: string
          approvals_count?: number
          approved_at?: string | null
          approved_by?: string | null
          ar_account_id?: string | null
          branch_code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          date_of_supply?: string | null
          discount_amount?: number
          due_date?: string | null
          email_recipient?: string | null
          email_status?: string | null
          exchange_rate?: number
          id?: string
          invoice_number?: string
          issue_date?: string
          journal_entry_id?: string | null
          last_emailed_at?: string | null
          mode_of_payment?: string | null
          notes?: string | null
          payment_terms?: string
          place_of_supply?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_status?: string
          required_approvals?: number
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
            foreignKeyName: "invoices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          is_adjusting: boolean
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
          is_adjusting?: boolean
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
          is_adjusting?: boolean
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
          memo: string | null
          seq: number
          tenant_id: string
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
          memo?: string | null
          seq?: number
          tenant_id?: string
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
          memo?: string | null
          seq?: number
          tenant_id?: string
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
      leave_balances: {
        Row: {
          adjustment: number
          available: number | null
          carried_forward: number
          created_at: string
          employee_id: string
          entitled: number
          id: string
          leave_type_id: string
          reserved: number
          taken: number
          tenant_id: string
          updated_at: string
          year: number
        }
        Insert: {
          adjustment?: number
          available?: number | null
          carried_forward?: number
          created_at?: string
          employee_id: string
          entitled?: number
          id?: string
          leave_type_id: string
          reserved?: number
          taken?: number
          tenant_id: string
          updated_at?: string
          year: number
        }
        Update: {
          adjustment?: number
          available?: number | null
          carried_forward?: number
          created_at?: string
          employee_id?: string
          entitled?: number
          id?: string
          leave_type_id?: string
          reserved?: number
          taken?: number
          tenant_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          days: number
          employee_id: string
          end_date: string
          half_day_period: string | null
          id: string
          is_half_day: boolean
          leave_type_id: string
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          request_number: string | null
          settled_at: string | null
          settled_in_run_id: string | null
          start_date: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          days: number
          employee_id: string
          end_date: string
          half_day_period?: string | null
          id?: string
          is_half_day?: boolean
          leave_type_id: string
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          request_number?: string | null
          settled_at?: string | null
          settled_in_run_id?: string | null
          start_date: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          days?: number
          employee_id?: string
          end_date?: string
          half_day_period?: string | null
          id?: string
          is_half_day?: boolean
          leave_type_id?: string
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          request_number?: string | null
          settled_at?: string | null
          settled_in_run_id?: string | null
          start_date?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_settled_in_run_id_fkey"
            columns: ["settled_in_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          allow_negative_balance: boolean
          annual_entitlement: number
          code: string
          color: string | null
          created_at: string
          default_annual_quota: number
          id: string
          is_active: boolean
          is_paid: boolean
          max_consecutive_days: number | null
          name: string
          payroll_treatment: string
          requires_approval: boolean
          tenant_id: string
        }
        Insert: {
          allow_negative_balance?: boolean
          annual_entitlement?: number
          code: string
          color?: string | null
          created_at?: string
          default_annual_quota?: number
          id?: string
          is_active?: boolean
          is_paid?: boolean
          max_consecutive_days?: number | null
          name: string
          payroll_treatment?: string
          requires_approval?: boolean
          tenant_id: string
        }
        Update: {
          allow_negative_balance?: boolean
          annual_entitlement?: number
          code?: string
          color?: string | null
          created_at?: string
          default_annual_quota?: number
          id?: string
          is_active?: boolean
          is_paid?: boolean
          max_consecutive_days?: number | null
          name?: string
          payroll_treatment?: string
          requires_approval?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      loan_repayments: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          id: string
          loan_id: string
          payroll_run_id: string | null
          tenant_id: string
        }
        Insert: {
          amount: number
          balance_after: number
          created_at?: string
          id?: string
          loan_id: string
          payroll_run_id?: string | null
          tenant_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          id?: string
          loan_id?: string
          payroll_run_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "employee_loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      payment_received_allocations: {
        Row: {
          amount: number
          amount_base: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
          tenant_id: string
        }
        Insert: {
          amount: number
          amount_base: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
          tenant_id: string
        }
        Update: {
          amount?: number
          amount_base?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_received_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_received_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_received"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_received_allocations_tenant_id_fkey"
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
          created_at: string
          created_by: string | null
          currency: string
          customer_id: string | null
          deposit_id: string | null
          exchange_rate: number
          funded_by_deposit_id: string | null
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          payment_date: string
          payment_method: string | null
          payment_number: string | null
          reference: string | null
          request_id: string | null
          reversal_journal_entry_id: string | null
          status: string
          tenant_id: string
          unapplied_amount: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          wht_amount: number
        }
        Insert: {
          amount: number
          ar_account_id?: string | null
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          deposit_id?: string | null
          exchange_rate?: number
          funded_by_deposit_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_number?: string | null
          reference?: string | null
          request_id?: string | null
          reversal_journal_entry_id?: string | null
          status?: string
          tenant_id: string
          unapplied_amount?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
        }
        Update: {
          amount?: number
          ar_account_id?: string | null
          bank_account_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_id?: string | null
          deposit_id?: string | null
          exchange_rate?: number
          funded_by_deposit_id?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_number?: string | null
          reference?: string | null
          request_id?: string | null
          reversal_journal_entry_id?: string | null
          status?: string
          tenant_id?: string
          unapplied_amount?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          wht_amount?: number
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
            foreignKeyName: "payments_received_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_deposit_id_fkey"
            columns: ["deposit_id"]
            isOneToOne: false
            referencedRelation: "customer_deposits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_funded_by_deposit_id_fkey"
            columns: ["funded_by_deposit_id"]
            isOneToOne: false
            referencedRelation: "customer_deposits"
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
          {
            foreignKeyName: "payments_received_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_received_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      payroll_department_gl: {
        Row: {
          account_id: string
          component_code: string
          created_at: string
          department: string
          id: string
          posting_side: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          component_code: string
          created_at?: string
          department: string
          id?: string
          posting_side?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          component_code?: string
          created_at?: string
          department?: string
          id?: string
          posting_side?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_department_gl_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_department_gl_tenant_id_fkey"
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
      payroll_remittances: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          liability_account_id: string
          notes: string | null
          payment_date: string
          payroll_run_id: string | null
          period: string
          reference: string | null
          remittance_type: string
          reversal_journal_entry_id: string | null
          status: string
          tenant_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          liability_account_id: string
          notes?: string | null
          payment_date: string
          payroll_run_id?: string | null
          period: string
          reference?: string | null
          remittance_type: string
          reversal_journal_entry_id?: string | null
          status?: string
          tenant_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          liability_account_id?: string
          notes?: string | null
          payment_date?: string
          payroll_run_id?: string | null
          period?: string
          reference?: string | null
          remittance_type?: string
          reversal_journal_entry_id?: string | null
          status?: string
          tenant_id?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_remittances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_remittances_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          arrears: number
          attendance_deduction: number
          basic_salary: number
          bik_value: number
          bonuses: number
          contractual_basic: number | null
          created_at: string
          days_present: number | null
          employee_epf: number
          employee_id: string
          employee_paye: number
          employer_epf: number
          employer_etf: number
          epf_base: number | null
          gross_pay: number
          hours_worked: number | null
          id: string
          loan_deduction: number
          net_pay: number
          non_epf_allowances: number
          notes: string | null
          other_deductions: number
          overtime_hours: number | null
          overtime_pay: number
          paid_leave_days: number | null
          payment_method: string
          run_id: string
          unpaid_absent_days: number | null
          working_days: number | null
        }
        Insert: {
          allowances?: number
          arrears?: number
          attendance_deduction?: number
          basic_salary?: number
          bik_value?: number
          bonuses?: number
          contractual_basic?: number | null
          created_at?: string
          days_present?: number | null
          employee_epf?: number
          employee_id: string
          employee_paye?: number
          employer_epf?: number
          employer_etf?: number
          epf_base?: number | null
          gross_pay?: number
          hours_worked?: number | null
          id?: string
          loan_deduction?: number
          net_pay?: number
          non_epf_allowances?: number
          notes?: string | null
          other_deductions?: number
          overtime_hours?: number | null
          overtime_pay?: number
          paid_leave_days?: number | null
          payment_method?: string
          run_id: string
          unpaid_absent_days?: number | null
          working_days?: number | null
        }
        Update: {
          allowances?: number
          arrears?: number
          attendance_deduction?: number
          basic_salary?: number
          bik_value?: number
          bonuses?: number
          contractual_basic?: number | null
          created_at?: string
          days_present?: number | null
          employee_epf?: number
          employee_id?: string
          employee_paye?: number
          employer_epf?: number
          employer_etf?: number
          epf_base?: number | null
          gross_pay?: number
          hours_worked?: number | null
          id?: string
          loan_deduction?: number
          net_pay?: number
          non_epf_allowances?: number
          notes?: string | null
          other_deductions?: number
          overtime_hours?: number | null
          overtime_pay?: number
          paid_leave_days?: number | null
          payment_method?: string
          run_id?: string
          unpaid_absent_days?: number | null
          working_days?: number | null
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
          payslips_published_at: string | null
          period_end: string
          period_start: string
          published_by: string | null
          rule_set_version_hash: string | null
          run_number: string
          status: string
          tenant_id: string
          total_deductions: number
          total_employer_epf: number
          total_employer_etf: number
          total_gross: number
          total_net: number
          total_paye: number
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
          payslips_published_at?: string | null
          period_end: string
          period_start: string
          published_by?: string | null
          rule_set_version_hash?: string | null
          run_number: string
          status?: string
          tenant_id: string
          total_deductions?: number
          total_employer_epf?: number
          total_employer_etf?: number
          total_gross?: number
          total_net?: number
          total_paye?: number
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
          payslips_published_at?: string | null
          period_end?: string
          period_start?: string
          published_by?: string | null
          rule_set_version_hash?: string | null
          run_number?: string
          status?: string
          tenant_id?: string
          total_deductions?: number
          total_employer_epf?: number
          total_employer_etf?: number
          total_gross?: number
          total_net?: number
          total_paye?: number
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
            foreignKeyName: "payroll_runs_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      payroll_settings: {
        Row: {
          cash_round_to: number
          enforce_sod: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cash_round_to?: number
          enforce_sod?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cash_round_to?: number
          enforce_sod?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pc_document_counters: {
        Row: {
          doc_type: string
          last_number: number
          tenant_id: string
          year: number
        }
        Insert: {
          doc_type: string
          last_number?: number
          tenant_id: string
          year: number
        }
        Update: {
          doc_type?: string
          last_number?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "pc_document_counters_tenant_id_fkey"
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
      petty_cash_count_denominations: {
        Row: {
          count_id: string
          denom_type: string
          denomination: number
          id: string
          quantity: number
          sort_order: number
          subtotal: number
        }
        Insert: {
          count_id: string
          denom_type?: string
          denomination: number
          id?: string
          quantity?: number
          sort_order?: number
          subtotal?: number
        }
        Update: {
          count_id?: string
          denom_type?: string
          denomination?: number
          id?: string
          quantity?: number
          sort_order?: number
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_count_denominations_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_counts"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_counts: {
        Row: {
          approved_by: string | null
          book_balance: number
          count_date: string
          count_number: string
          counted_balance: number
          counted_by: string | null
          created_at: string
          id: string
          journal_entry_id: string | null
          notes: string | null
          petty_cash_account_id: string
          posted_at: string | null
          status: string
          tenant_id: string
          variance: number
        }
        Insert: {
          approved_by?: string | null
          book_balance?: number
          count_date?: string
          count_number: string
          counted_balance?: number
          counted_by?: string | null
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          petty_cash_account_id: string
          posted_at?: string | null
          status?: string
          tenant_id: string
          variance?: number
        }
        Update: {
          approved_by?: string | null
          book_balance?: number
          count_date?: string
          count_number?: string
          counted_balance?: number
          counted_by?: string | null
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          petty_cash_account_id?: string
          posted_at?: string | null
          status?: string
          tenant_id?: string
          variance?: number
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_counts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_petty_cash_account_id_fkey"
            columns: ["petty_cash_account_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_counts_tenant_id_fkey"
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
          replenishment_id: string | null
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
          replenishment_id?: string | null
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
          replenishment_id?: string | null
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
            foreignKeyName: "petty_cash_vouchers_replenishment_id_fkey"
            columns: ["replenishment_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_replenishments"
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
      posting_profiles: {
        Row: {
          account_role: string
          created_at: string
          description: string | null
          effective_from: string
          effective_to: string | null
          entity_scope: Json | null
          gl_account_id: string
          id: string
          is_active: boolean
          module: string
          priority: number
          tenant_id: string
          transaction_type: string
          updated_at: string
        }
        Insert: {
          account_role: string
          created_at?: string
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          entity_scope?: Json | null
          gl_account_id: string
          id?: string
          is_active?: boolean
          module: string
          priority?: number
          tenant_id: string
          transaction_type: string
          updated_at?: string
        }
        Update: {
          account_role?: string
          created_at?: string
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          entity_scope?: Json | null
          gl_account_id?: string
          id?: string
          is_active?: boolean
          module?: string
          priority?: number
          tenant_id?: string
          transaction_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posting_profiles_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posting_profiles_tenant_id_fkey"
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
          default_tax_code_id: string | null
          default_tax_group_id: string | null
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
          default_tax_code_id?: string | null
          default_tax_group_id?: string | null
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
          default_tax_code_id?: string | null
          default_tax_group_id?: string | null
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
            foreignKeyName: "products_default_tax_code_id_fkey"
            columns: ["default_tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_default_tax_group_id_fkey"
            columns: ["default_tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
          is_tax_inclusive: boolean
          item_id: string
          line_total: number
          po_id: string
          qty_ordered: number
          qty_received: number
          tax_amount_line: number
          tax_code_id: string | null
          tax_group_id: string | null
          tax_id: string | null
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_tax_inclusive?: boolean
          item_id: string
          line_total?: number
          po_id: string
          qty_ordered: number
          qty_received?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          tax_id?: string | null
          tenant_id: string
          unit_cost: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_tax_inclusive?: boolean
          item_id?: string
          line_total?: number
          po_id?: string
          qty_ordered?: number
          qty_received?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
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
          {
            foreignKeyName: "purchase_order_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          closed_at: string | null
          closed_by: string | null
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
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
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
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          closed_at?: string | null
          closed_by?: string | null
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
            foreignKeyName: "purchase_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
      quote_counters: {
        Row: {
          last_number: number
          tenant_id: string
          year: number
        }
        Insert: {
          last_number?: number
          tenant_id: string
          year: number
        }
        Update: {
          last_number?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          account_id: string | null
          description: string | null
          discount_amount: number
          discount_percent: number
          id: string
          is_tax_inclusive: boolean
          product_id: string | null
          quantity: number
          quote_id: string
          sort_order: number
          tax_code_id: string | null
          tax_group_id: string | null
          total: number
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          quote_id: string
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          total?: number
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          discount_percent?: number
          id?: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          quote_id?: string
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          branch_code: string | null
          converted_invoice_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          discount_amount: number
          expiry_date: string | null
          id: string
          issue_date: string
          notes: string | null
          payment_terms: string
          quote_number: string
          status: string
          subtotal: number
          tax_amount: number
          tenant_id: string
          terms: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          branch_code?: string | null
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          discount_amount?: number
          expiry_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          payment_terms?: string
          quote_number: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id: string
          terms?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          branch_code?: string | null
          converted_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          discount_amount?: number
          expiry_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          payment_terms?: string
          quote_number?: string
          status?: string
          subtotal?: number
          tax_amount?: number
          tenant_id?: string
          terms?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_converted_invoice_id_fkey"
            columns: ["converted_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_counters: {
        Row: {
          last_number: number
          tenant_id: string
          year: number
        }
        Insert: {
          last_number?: number
          tenant_id: string
          year: number
        }
        Update: {
          last_number?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "receipt_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          action_direction: string
          action_type: string
          condition_amount_max: number | null
          condition_amount_min: number | null
          condition_field: string
          condition_operator: string
          condition_value: string
          counterparty_name: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          priority: number
          tax_account_id: string | null
          tax_rate: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_account_id?: string | null
          action_create_expense?: boolean
          action_direction?: string
          action_type?: string
          condition_amount_max?: number | null
          condition_amount_min?: number | null
          condition_field?: string
          condition_operator?: string
          condition_value: string
          counterparty_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          priority?: number
          tax_account_id?: string | null
          tax_rate?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_account_id?: string | null
          action_create_expense?: boolean
          action_direction?: string
          action_type?: string
          condition_amount_max?: number | null
          condition_amount_min?: number | null
          condition_field?: string
          condition_operator?: string
          condition_value?: string
          counterparty_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          priority?: number
          tax_account_id?: string | null
          tax_rate?: number
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
            foreignKeyName: "reconciliation_rules_tax_account_id_fkey"
            columns: ["tax_account_id"]
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
      recurring_invoice_items: {
        Row: {
          account_id: string | null
          description: string | null
          discount_amount: number
          id: string
          is_tax_inclusive: boolean
          product_id: string | null
          quantity: number
          recurring_invoice_id: string
          sort_order: number
          tax_code_id: string | null
          tax_group_id: string | null
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          id?: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          recurring_invoice_id: string
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          description?: string | null
          discount_amount?: number
          id?: string
          is_tax_inclusive?: boolean
          product_id?: string | null
          quantity?: number
          recurring_invoice_id?: string
          sort_order?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_items_recurring_invoice_id_fkey"
            columns: ["recurring_invoice_id"]
            isOneToOne: false
            referencedRelation: "recurring_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_items_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_items_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoices: {
        Row: {
          auto_post: boolean
          branch_code: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          end_date: string | null
          frequency: string
          id: string
          interval_count: number
          max_occurrences: number | null
          next_run_date: string
          notes: string | null
          occurrences_generated: number
          payment_terms: string
          start_date: string
          status: string
          template_name: string
          tenant_id: string
          terms: string | null
          updated_at: string
        }
        Insert: {
          auto_post?: boolean
          branch_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          end_date?: string | null
          frequency: string
          id?: string
          interval_count?: number
          max_occurrences?: number | null
          next_run_date: string
          notes?: string | null
          occurrences_generated?: number
          payment_terms?: string
          start_date: string
          status?: string
          template_name: string
          tenant_id: string
          terms?: string | null
          updated_at?: string
        }
        Update: {
          auto_post?: boolean
          branch_code?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          end_date?: string | null
          frequency?: string
          id?: string
          interval_count?: number
          max_occurrences?: number | null
          next_run_date?: string
          notes?: string | null
          occurrences_generated?: number
          payment_terms?: string
          start_date?: string
          status?: string
          template_name?: string
          tenant_id?: string
          terms?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      signup_requests: {
        Row: {
          company_name: string
          country: string | null
          created_at: string
          email: string
          first_name: string
          id: string
          industry: string | null
          last_name: string
          message: string | null
          phone: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          team_size: string | null
          tenant_id: string | null
        }
        Insert: {
          company_name: string
          country?: string | null
          created_at?: string
          email: string
          first_name: string
          id?: string
          industry?: string | null
          last_name: string
          message?: string | null
          phone?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_size?: string | null
          tenant_id?: string | null
        }
        Update: {
          company_name?: string
          country?: string | null
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          industry?: string | null
          last_name?: string
          message?: string | null
          phone?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          team_size?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signup_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signup_requests_tenant_id_fkey"
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
      supplier_accounts: {
        Row: {
          ap_account_id: string | null
          created_at: string
          current_balance: number
          id: string
          payment_terms_days: number
          tenant_id: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          ap_account_id?: string | null
          created_at?: string
          current_balance?: number
          id?: string
          payment_terms_days?: number
          tenant_id: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          ap_account_id?: string | null
          created_at?: string
          current_balance?: number
          id?: string
          payment_terms_days?: number
          tenant_id?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_accounts_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_accounts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
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
          is_tax_inclusive: boolean
          item_id: string | null
          line_total: number
          qty: number
          tax_amount_line: number
          tax_code_id: string | null
          tax_group_id: string | null
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
          is_tax_inclusive?: boolean
          item_id?: string | null
          line_total?: number
          qty?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
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
          is_tax_inclusive?: boolean
          item_id?: string | null
          line_total?: number
          qty?: number
          tax_amount_line?: number
          tax_code_id?: string | null
          tax_group_id?: string | null
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
          {
            foreignKeyName: "supplier_bill_lines_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_bill_lines_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
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
          posting_status: string
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
          posting_status?: string
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
          posting_status?: string
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
      tax_code_rates: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          rate: number
          tax_code_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          rate: number
          tax_code_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          rate?: number
          tax_code_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_code_rates_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_code_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_codes: {
        Row: {
          code: string
          collection_mode: string
          created_at: string
          id: string
          input_receivable_account_id: string | null
          is_active: boolean
          is_compound: boolean
          is_inclusive_default: boolean
          is_recoverable: boolean
          name: string
          output_liability_account_id: string | null
          rounding_level: string
          rounding_method: string
          tax_type: string
          tenant_id: string
          updated_at: string
          wht_payable_account_id: string | null
          wht_receivable_account_id: string | null
        }
        Insert: {
          code: string
          collection_mode: string
          created_at?: string
          id?: string
          input_receivable_account_id?: string | null
          is_active?: boolean
          is_compound?: boolean
          is_inclusive_default?: boolean
          is_recoverable?: boolean
          name: string
          output_liability_account_id?: string | null
          rounding_level?: string
          rounding_method?: string
          tax_type: string
          tenant_id: string
          updated_at?: string
          wht_payable_account_id?: string | null
          wht_receivable_account_id?: string | null
        }
        Update: {
          code?: string
          collection_mode?: string
          created_at?: string
          id?: string
          input_receivable_account_id?: string | null
          is_active?: boolean
          is_compound?: boolean
          is_inclusive_default?: boolean
          is_recoverable?: boolean
          name?: string
          output_liability_account_id?: string | null
          rounding_level?: string
          rounding_method?: string
          tax_type?: string
          tenant_id?: string
          updated_at?: string
          wht_payable_account_id?: string | null
          wht_receivable_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_codes_input_receivable_account_id_fkey"
            columns: ["input_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_codes_output_liability_account_id_fkey"
            columns: ["output_liability_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_codes_wht_payable_account_id_fkey"
            columns: ["wht_payable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_codes_wht_receivable_account_id_fkey"
            columns: ["wht_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_group_members: {
        Row: {
          apply_order: number
          compound_on_previous: boolean
          created_at: string
          id: string
          tax_code_id: string
          tax_group_id: string
          tenant_id: string
        }
        Insert: {
          apply_order: number
          compound_on_previous?: boolean
          created_at?: string
          id?: string
          tax_code_id: string
          tax_group_id: string
          tenant_id: string
        }
        Update: {
          apply_order?: number
          compound_on_previous?: boolean
          created_at?: string
          id?: string
          tax_code_id?: string
          tax_group_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_group_members_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_group_members_tax_group_id_fkey"
            columns: ["tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_group_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_groups: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_groups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_periods: {
        Row: {
          created_at: string
          id: string
          period_end: string
          period_start: string
          status: string
          tax_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          status?: string
          tax_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          status?: string
          tax_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_records: {
        Row: {
          direction: string | null
          id: string
          invoice_id: string | null
          journal_entry_id: string | null
          source_id: string | null
          source_type: string | null
          tax_amount: number
          tax_id: string | null
          tenant_id: string | null
          transaction_date: string | null
        }
        Insert: {
          direction?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          tax_amount?: number
          tax_id?: string | null
          tenant_id?: string | null
          transaction_date?: string | null
        }
        Update: {
          direction?: string | null
          id?: string
          invoice_id?: string | null
          journal_entry_id?: string | null
          source_id?: string | null
          source_type?: string | null
          tax_amount?: number
          tax_id?: string | null
          tenant_id?: string | null
          transaction_date?: string | null
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
            foreignKeyName: "tax_records_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_records_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_remittances: {
        Row: {
          amount: number
          bank_account_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          reference: string | null
          remittance_date: string
          status: string
          tax_code_id: string
          tax_period_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          reference?: string | null
          remittance_date: string
          status?: string
          tax_code_id: string
          tax_period_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          reference?: string | null
          remittance_date?: string
          status?: string
          tax_code_id?: string
          tax_period_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_remittances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_remittances_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_remittances_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_remittances_tax_period_id_fkey"
            columns: ["tax_period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_remittances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_returns: {
        Row: {
          created_at: string
          filed_at: string | null
          filed_by: string | null
          id: string
          ird_reference: string | null
          return_type: string
          status: string
          summary_json: Json
          tax_period_id: string
          tenant_id: string
          total_credit: number | null
          total_payable: number | null
        }
        Insert: {
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          ird_reference?: string | null
          return_type: string
          status?: string
          summary_json: Json
          tax_period_id: string
          tenant_id: string
          total_credit?: number | null
          total_payable?: number | null
        }
        Update: {
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          ird_reference?: string | null
          return_type?: string
          status?: string
          summary_json?: Json
          tax_period_id?: string
          tenant_id?: string
          total_credit?: number | null
          total_payable?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_returns_tax_period_id_fkey"
            columns: ["tax_period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_transactions: {
        Row: {
          base_amount: number
          created_at: string
          currency: string
          direction: string
          fx_rate: number
          id: string
          is_reversed: boolean
          journal_entry_id: string | null
          note: string | null
          rate_applied: number
          reversal_of_id: string | null
          source_id: string
          source_line_id: string | null
          source_type: string
          tax_amount: number
          tax_amount_txn_currency: number | null
          tax_code_id: string
          tax_period_id: string | null
          tenant_id: string
          transaction_date: string
          wht_certificate_no: string | null
        }
        Insert: {
          base_amount: number
          created_at?: string
          currency?: string
          direction: string
          fx_rate?: number
          id?: string
          is_reversed?: boolean
          journal_entry_id?: string | null
          note?: string | null
          rate_applied: number
          reversal_of_id?: string | null
          source_id: string
          source_line_id?: string | null
          source_type: string
          tax_amount: number
          tax_amount_txn_currency?: number | null
          tax_code_id: string
          tax_period_id?: string | null
          tenant_id: string
          transaction_date: string
          wht_certificate_no?: string | null
        }
        Update: {
          base_amount?: number
          created_at?: string
          currency?: string
          direction?: string
          fx_rate?: number
          id?: string
          is_reversed?: boolean
          journal_entry_id?: string | null
          note?: string | null
          rate_applied?: number
          reversal_of_id?: string | null
          source_id?: string
          source_line_id?: string | null
          source_type?: string
          tax_amount?: number
          tax_amount_txn_currency?: number | null
          tax_code_id?: string
          tax_period_id?: string | null
          tenant_id?: string
          transaction_date?: string
          wht_certificate_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_transactions_reversal_of_id_fkey"
            columns: ["reversal_of_id"]
            isOneToOne: false
            referencedRelation: "tax_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_transactions_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_transactions_tax_period_id_fkey"
            columns: ["tax_period_id"]
            isOneToOne: false
            referencedRelation: "tax_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      tenant_number_counters: {
        Row: {
          counter_key: string
          current_value: number
          tenant_id: string
        }
        Insert: {
          counter_key: string
          current_value?: number
          tenant_id: string
        }
        Update: {
          counter_key?: string
          current_value?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_number_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_tax_profiles: {
        Row: {
          created_at: string
          default_purchase_tax_code_id: string | null
          default_sales_tax_group_id: string | null
          id: string
          is_sscl_liable: boolean
          is_svat_registered: boolean
          is_vat_registered: boolean
          sscl_registration_number: string | null
          tenant_id: string
          tin: string | null
          updated_at: string
          vat_filing_frequency: string
          vat_registered_from: string | null
          vat_registration_number: string | null
          wht_agent: boolean
        }
        Insert: {
          created_at?: string
          default_purchase_tax_code_id?: string | null
          default_sales_tax_group_id?: string | null
          id?: string
          is_sscl_liable?: boolean
          is_svat_registered?: boolean
          is_vat_registered?: boolean
          sscl_registration_number?: string | null
          tenant_id: string
          tin?: string | null
          updated_at?: string
          vat_filing_frequency?: string
          vat_registered_from?: string | null
          vat_registration_number?: string | null
          wht_agent?: boolean
        }
        Update: {
          created_at?: string
          default_purchase_tax_code_id?: string | null
          default_sales_tax_group_id?: string | null
          id?: string
          is_sscl_liable?: boolean
          is_svat_registered?: boolean
          is_vat_registered?: boolean
          sscl_registration_number?: string | null
          tenant_id?: string
          tin?: string | null
          updated_at?: string
          vat_filing_frequency?: string
          vat_registered_from?: string | null
          vat_registration_number?: string | null
          wht_agent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tenant_tax_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttp_default_purchase_tax_code_fk"
            columns: ["default_purchase_tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ttp_default_sales_tax_group_fk"
            columns: ["default_sales_tax_group_id"]
            isOneToOne: false
            referencedRelation: "tax_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address: string | null
          company_name: string
          country: string | null
          created_at: string
          deleted_at: string | null
          id: string
          industry: string | null
          logo_url: string | null
          phone: string | null
          registration_number: string | null
          status: string
          subscription_plan_id: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_name: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          phone?: string | null
          registration_number?: string | null
          status?: string
          subscription_plan_id?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_name?: string
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          phone?: string | null
          registration_number?: string | null
          status?: string
          subscription_plan_id?: string | null
          tax_id?: string | null
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
      vendor_credit_notes: {
        Row: {
          amount: number
          ap_account_id: string | null
          bill_id: string | null
          created_at: string
          credit_date: string
          credit_note_number: string
          expense_account_id: string | null
          id: string
          journal_entry_id: string | null
          reason: string | null
          status: string
          tenant_id: string
          updated_at: string
          vendor_id: string
        }
        Insert: {
          amount: number
          ap_account_id?: string | null
          bill_id?: string | null
          created_at?: string
          credit_date?: string
          credit_note_number: string
          expense_account_id?: string | null
          id?: string
          journal_entry_id?: string | null
          reason?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vendor_id: string
        }
        Update: {
          amount?: number
          ap_account_id?: string | null
          bill_id?: string | null
          created_at?: string
          credit_date?: string
          credit_note_number?: string
          expense_account_id?: string | null
          id?: string
          journal_entry_id?: string | null
          reason?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_credit_notes_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_credit_notes_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "supplier_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_credit_notes_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_credit_notes_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_credit_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_credit_notes_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          created_at: string
          default_payment_nature: string | null
          email: string | null
          id: string
          name: string
          opening_balance: number
          payee_type: string | null
          phone: string | null
          tenant_id: string
          tin: string | null
          updated_at: string
          wht_exempt: boolean
          wht_exemption_ref: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          default_payment_nature?: string | null
          email?: string | null
          id?: string
          name: string
          opening_balance?: number
          payee_type?: string | null
          phone?: string | null
          tenant_id: string
          tin?: string | null
          updated_at?: string
          wht_exempt?: boolean
          wht_exemption_ref?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          default_payment_nature?: string | null
          email?: string | null
          id?: string
          name?: string
          opening_balance?: number
          payee_type?: string | null
          phone?: string | null
          tenant_id?: string
          tin?: string | null
          updated_at?: string
          wht_exempt?: boolean
          wht_exemption_ref?: string | null
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
      wht_rules: {
        Row: {
          certificate_required: boolean
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          payee_type: string
          payment_nature: string
          rate: number
          tax_code_id: string
          tenant_id: string
          threshold_amount: number | null
          threshold_period: string | null
        }
        Insert: {
          certificate_required?: boolean
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          payee_type: string
          payment_nature: string
          rate: number
          tax_code_id: string
          tenant_id: string
          threshold_amount?: number | null
          threshold_period?: string | null
        }
        Update: {
          certificate_required?: boolean
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          payee_type?: string
          payment_nature?: string
          rate?: number
          tax_code_id?: string
          tenant_id?: string
          threshold_amount?: number | null
          threshold_period?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wht_rules_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wht_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      work_shifts: {
        Row: {
          break_after_hours: number
          break_minutes: number
          created_at: string
          crosses_midnight: boolean
          deduct_undertime: boolean
          end_time: string
          half_day_hours: number
          holiday_ot_multiplier: number
          id: string
          is_active: boolean
          is_default: boolean
          late_grace_minutes: number
          name: string
          ot_cap_hours: number
          ot_includes_allowances: boolean
          ot_multiplier: number
          ot_threshold_hours: number
          standard_hours: number
          start_time: string
          tenant_id: string
          working_days: number[]
        }
        Insert: {
          break_after_hours?: number
          break_minutes?: number
          created_at?: string
          crosses_midnight?: boolean
          deduct_undertime?: boolean
          end_time?: string
          half_day_hours?: number
          holiday_ot_multiplier?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          late_grace_minutes?: number
          name: string
          ot_cap_hours?: number
          ot_includes_allowances?: boolean
          ot_multiplier?: number
          ot_threshold_hours?: number
          standard_hours?: number
          start_time?: string
          tenant_id: string
          working_days?: number[]
        }
        Update: {
          break_after_hours?: number
          break_minutes?: number
          created_at?: string
          crosses_midnight?: boolean
          deduct_undertime?: boolean
          end_time?: string
          half_day_hours?: number
          holiday_ot_multiplier?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          late_grace_minutes?: number
          name?: string
          ot_cap_hours?: number
          ot_includes_allowances?: boolean
          ot_multiplier?: number
          ot_threshold_hours?: number
          standard_hours?: number
          start_time?: string
          tenant_id?: string
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "work_shifts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      payroll_liability_summary: {
        Row: {
          accrued_amount: number | null
          due_date: string | null
          outstanding_amount: number | null
          period: string | null
          remittance_status: string | null
          remittance_type: string | null
          remitted_amount: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      account_earliest_entry_date: {
        Args: { p_account_id: string }
        Returns: string
      }
      account_ledger_facets: {
        Args: { p_account_id: string; p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      account_ledger_lines: {
        Args: { p_account_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          cheque: string
          contra_lines: Json
          created_at: string
          credit: number
          debit: number
          description: string
          entry_date: string
          entry_id: string
          entry_type: string
          is_system_generated: boolean
          line_id: string
          payee: string
          reference: string
          reversal_of: string
          source_type: string
          status: string
          void_reason: string
          voided_at: string
        }[]
      }
      account_ledger_page: {
        Args: {
          p_account_id: string
          p_date_from?: string
          p_date_to?: string
          p_entry_type?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_sort_dir?: string
          p_txn_type?: string
        }
        Returns: {
          cheque: string
          contra_lines: Json
          created_at: string
          credit: number
          cum_credit: number
          cum_debit: number
          debit: number
          description: string
          entry_date: string
          entry_id: string
          entry_type: string
          filtered_credit: number
          filtered_debit: number
          filtered_rows: number
          is_system_generated: boolean
          line_id: string
          payee: string
          reference: string
          reversal_of: string
          source_type: string
          status: string
          txn_type: string
          void_reason: string
          voided_at: string
        }[]
      }
      account_ledger_totals: {
        Args: { p_account_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          line_count: number
          total_credit: number
          total_debit: number
        }[]
      }
      account_opening_balance: {
        Args: { p_account_id: string; p_date_from: string }
        Returns: {
          credit: number
          debit: number
        }[]
      }
      aggregate_attendance_batch: {
        Args: { p_batch_id: string }
        Returns: {
          days_written: number
        }[]
      }
      ap_aging_report: { Args: { p_as_of_date?: string }; Returns: Json }
      ap_reconciliation_check: {
        Args: { p_as_of_date?: string }
        Returns: Json
      }
      approve_credit_note: {
        Args: { p_credit_note_id: string; p_decision: string; p_note?: string }
        Returns: Json
      }
      approve_expense: { Args: { p_expense_id: string }; Returns: string }
      approve_invoice: {
        Args: { p_decision: string; p_invoice_id: string; p_note?: string }
        Returns: Json
      }
      approve_leave_request: { Args: { p_request_id: string }; Returns: Json }
      approve_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      ar_aging_report: { Args: { p_as_of_date?: string }; Returns: Json }
      ar_reconciliation_check: {
        Args: { p_as_of_date?: string }
        Returns: Json
      }
      asset_reconciliation_check: { Args: never; Returns: Json }
      bank_import_suspense_report: { Args: { p_as_of?: string }; Returns: Json }
      bank_normalize_text: { Args: { p_input: string }; Returns: string }
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
      calculate_gl_balance_for_account: {
        Args: { p_account_id: string; p_tenant_id: string }
        Returns: {
          balance: number
        }[]
      }
      cancel_invoice_serial: {
        Args: { p_reason: string; p_serial: string }
        Returns: undefined
      }
      cancel_leave_request: { Args: { p_request_id: string }; Returns: Json }
      cancel_stock_count: { Args: { p_count_id: string }; Returns: Json }
      claim_bank_statement_periods: {
        Args: { p_batch_id: string; p_periods: Json }
        Returns: number
      }
      clear_suspense_lines: {
        Args: {
          p_line_ids: string[]
          p_note?: string
          p_target_account_id: string
          p_teach_variant?: string
        }
        Returns: Json
      }
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
      count_journal_entries: {
        Args: { p_search?: string; p_source?: string; p_status?: string }
        Returns: number
      }
      count_working_days: {
        Args: {
          p_end: string
          p_is_half_day?: boolean
          p_start: string
          p_tenant_id: string
        }
        Returns: number
      }
      count_working_days_dows: {
        Args: {
          p_dows: number[]
          p_end: string
          p_is_half_day?: boolean
          p_start: string
          p_tenant_id: string
        }
        Returns: number
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
      eligible_invoice_approvers: {
        Args: { p_tenant_id: string }
        Returns: {
          user_id: string
        }[]
      }
      ensure_cash_over_short_account: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      ensure_current_fiscal_period:
        | { Args: never; Returns: string }
        | { Args: { p_tenant_id: string }; Returns: string }
      ensure_leave_balance: {
        Args: {
          p_emp: string
          p_tenant: string
          p_type: string
          p_year: number
        }
        Returns: string
      }
      ensure_tax_account: {
        Args: {
          p_code: string
          p_name: string
          p_normal: string
          p_subtype: string
          p_tenant_id: string
          p_type: string
        }
        Returns: string
      }
      field_check_in: {
        Args: {
          p_accuracy?: number
          p_client_name?: string
          p_lat?: number
          p_lng?: number
          p_notes?: string
        }
        Returns: {
          attendance_status: string | null
          check_in_accuracy: number | null
          check_in_at: string
          check_in_lat: number | null
          check_in_lng: number | null
          check_out_accuracy: number | null
          check_out_at: string | null
          check_out_lat: number | null
          check_out_lng: number | null
          client_name: string | null
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          visit_date: string
        }
        SetofOptions: {
          from: "*"
          to: "field_visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      field_check_out: {
        Args: {
          p_accuracy?: number
          p_lat?: number
          p_lng?: number
          p_visit_id: string
        }
        Returns: {
          attendance_status: string | null
          check_in_accuracy: number | null
          check_in_at: string
          check_in_lat: number | null
          check_in_lng: number | null
          check_out_accuracy: number | null
          check_out_at: string | null
          check_out_lat: number | null
          check_out_lng: number | null
          client_name: string | null
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
          visit_date: string
        }
        SetofOptions: {
          from: "*"
          to: "field_visits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_fs_eval_statement: {
        Args: { p_date_from: string; p_date_to: string; p_statement_id: string }
        Returns: {
          account_count: number
          line_id: string
          margin: number
          value: number
        }[]
      }
      fx_rate: {
        Args: { p_currency: string; p_date: string; p_tenant_id: string }
        Returns: number
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
      generate_tax_periods: {
        Args: { p_tax_type: string; p_tenant_id: string; p_year: number }
        Returns: number
      }
      generate_voucher_number: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      generate_wht_certificate_no: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      get_account_settings_completeness: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      get_attendance_summary: {
        Args: {
          p_employee_id?: string
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          days_present: number
          employee_id: string
          non_employed_days: number
          overtime_hours: number
          paid_leave_days: number
          unmarked_days: number
          unpaid_absent_days: number
          working_days: number
        }[]
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
      get_customer_statement: {
        Args: { p_customer_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      get_or_create_derived_accounts: {
        Args: { p_actor_user_id: string; p_items: Json; p_tenant_id: string }
        Returns: {
          account_id: string
          derive_key: string
          side: string
        }[]
      }
      get_tax_members: {
        Args: { p_as_of: string; p_tax_code_id: string; p_tax_group_id: string }
        Returns: {
          apply_order: number
          code: string
          collection_mode: string
          input_receivable_account_id: string
          is_compound: boolean
          is_recoverable: boolean
          output_liability_account_id: string
          rate: number
          tax_code_id: string
          tax_type: string
          wht_payable_account_id: string
          wht_receivable_account_id: string
        }[]
      }
      get_tax_rate: {
        Args: { p_as_of: string; p_tax_code_id: string }
        Returns: number
      }
      get_user_employee_id: { Args: never; Returns: string }
      get_user_permission: {
        Args: { p_module: string; p_user_id: string }
        Returns: string
      }
      get_user_role_name: { Args: never; Returns: string }
      get_user_tenant_id: { Args: never; Returns: string }
      gl_account_balances: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          credit: number
          debit: number
        }[]
      }
      gl_monthly_account_movements: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          credit: number
          debit: number
          month: string
        }[]
      }
      import_bank_statement_post: {
        Args: { p_actor_user_id: string; p_batch_id: string }
        Returns: Json
      }
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
      is_attendance_period_locked: {
        Args: { p_date: string; p_tenant_id: string }
        Returns: boolean
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
      je_filter_sql: {
        Args: { p_search: string; p_source: string; p_status: string }
        Returns: string
      }
      journal_entry_stats: {
        Args: never
        Returns: {
          posted: number
          total: number
          voided: number
        }[]
      }
      ledger_txn_type: {
        Args: { p_desc: string; p_ref: string }
        Returns: string
      }
      list_journal_entries: {
        Args: {
          p_backward?: boolean
          p_cursor_created?: string
          p_cursor_date?: string
          p_cursor_id?: string
          p_limit?: number
          p_search?: string
          p_source?: string
          p_status?: string
        }
        Returns: {
          created_at: string
          description: string
          entry_date: string
          entry_type: string
          id: string
          is_system_generated: boolean
          journal_lines: Json
          reference: string
          reversal_of: string
          source_type: string
          status: string
          total_credit: number
          total_debit: number
          void_reason: string
          voided_at: string
        }[]
      }
      next_credit_note_number: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      next_free_account_code: {
        Args: { p_base: string; p_tenant_id: string }
        Returns: string
      }
      next_invoice_serial: {
        Args: { p_branch_code: string; p_issue_date: string }
        Returns: string
      }
      next_quote_number: { Args: { p_tenant_id: string }; Returns: string }
      next_receipt_number: { Args: { p_tenant_id: string }; Returns: string }
      next_tenant_number: {
        Args: { p_key: string; p_tenant_id: string }
        Returns: number
      }
      payment_term_days: { Args: { p_term: string }; Returns: number }
      pc_locked_ledger_balance: {
        Args: { p_pc_account_id: string; p_tenant_id: string }
        Returns: number
      }
      pc_next_document_number: {
        Args: { p_doc_type: string; p_tenant_id: string }
        Returns: string
      }
      pc_unreimbursed_vouchers: {
        Args: { p_pc_account_id: string }
        Returns: {
          paid_to: string
          total_amount: number
          voucher_date: string
          voucher_id: string
          voucher_number: string
        }[]
      }
      pending_signup_request_count: { Args: never; Returns: number }
      post_assembly_order: { Args: { p_ao_id: string }; Returns: Json }
      post_delivery_note: { Args: { p_id: string }; Returns: Json }
      post_grn: { Args: { p_grn_id: string }; Returns: Json }
      post_imprest_replenishment: {
        Args: {
          p_allow_partial?: boolean
          p_bank_account_id: string
          p_date?: string
          p_pc_account_id: string
          p_voucher_ids?: string[]
        }
        Returns: Json
      }
      post_landed_cost_voucher: {
        Args: { p_voucher_id: string }
        Returns: Json
      }
      post_pc_count: { Args: { p_count_id: string }; Returns: string }
      post_pcr: { Args: { p_replenishment_id: string }; Returns: string }
      post_pcv: { Args: { p_voucher_id: string }; Returns: string }
      post_purchase_return: { Args: { p_id: string }; Returns: Json }
      post_sales_return: { Args: { p_id: string }; Returns: Json }
      post_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      post_stock_count: { Args: { p_count_id: string }; Returns: Json }
      post_stock_transfer: { Args: { p_transfer_id: string }; Returns: string }
      post_supplier_bill: { Args: { p_bill_id: string }; Returns: Json }
      post_tax_remittance: { Args: { p_remittance_id: string }; Returns: Json }
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
      recalc_budget_for_bank_batch: {
        Args: { p_batch_id: string }
        Returns: number
      }
      recalc_daily_balances_from: {
        Args: { p_from: string; p_tenant_id: string }
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
      reconcile_inventory_qty: { Args: { p_item_id?: string }; Returns: Json }
      recurring_next_date: {
        Args: { p_frequency: string; p_from: string; p_interval: number }
        Returns: string
      }
      reject_leave_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: Json
      }
      reject_stock_adjustment: {
        Args: { p_adjustment_id: string; p_reason: string }
        Returns: Json
      }
      resolve_posting_profile: {
        Args: {
          p_date?: string
          p_entity_scope?: Json
          p_module: string
          p_transaction_type: string
        }
        Returns: Json
      }
      revalue_ar_fx: { Args: { p_period_end: string }; Returns: Json }
      reverse_tax_transactions: {
        Args: {
          p_reversal_date: string
          p_reversal_journal_id: string
          p_source_id: string
          p_source_type: string
          p_tenant_id: string
        }
        Returns: number
      }
      rpc_apply_loan_repayments: { Args: { p_run_id: string }; Returns: Json }
      rpc_final_settlement: { Args: { p_employee_id: string }; Returns: Json }
      rpc_fs_coverage: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_statement_code: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          amount: number
          detail: string
          issue_code: string
          severity: string
        }[]
      }
      rpc_fs_seed_soci: { Args: { p_force?: boolean }; Returns: string }
      rpc_fs_statement: {
        Args: {
          p_cmp_date_from?: string
          p_cmp_date_to?: string
          p_date_from: string
          p_date_to: string
          p_statement_code: string
        }
        Returns: {
          account_count: number
          compare_margin: number
          compare_value: number
          current_margin: number
          current_value: number
          emphasis: string
          label: string
          line_code: string
          line_id: string
          line_type: string
          note_ref: string
          show_margin: boolean
          sort_order: number
        }[]
      }
      rpc_gl_account_tree: {
        Args: {
          p_account_type?: string
          p_date_from: string
          p_date_to: string
          p_include_inactive?: boolean
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          depth: number
          has_children: boolean
          is_other_node: boolean
          label: string
          node_key: string
          own_credit: number
          own_debit: number
          own_opening: number
          own_txn_count: number
          parent_account_id: string
          sort_path: string
          subtree_credit: number
          subtree_debit: number
          subtree_opening: number
        }[]
      }
      rpc_gl_integrity: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: {
          amount: number
          code: string
          detail: string
          entity_id: string
          severity: string
        }[]
      }
      rpc_gl_transactions: {
        Args: {
          p_account_ids?: string[]
          p_date_from: string
          p_date_to: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          account_id: string
          credit: number
          debit: number
          entity_name: string
          entry_date: string
          entry_id: string
          is_adjusting: boolean
          line_id: string
          line_seq: number
          memo: string
          num: string
          running_balance: number
          split_text: string
          total_rows: number
          txn_type: string
        }[]
      }
      rpc_gratuity_schedule: {
        Args: never
        Returns: {
          accrued_amount: number
          eligible: boolean
          employee_id: string
          employee_name: string
          employee_number: string
          hire_date: string
          monthly_salary: number
          termination_date: string
          years_of_service: number
        }[]
      }
      rpc_period_attendance_summary: {
        Args: {
          p_employee_ids?: string[]
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          absent_days: number
          employee_id: string
          expected_days: number
          half_days: number
          holiday_ot_hours: number
          holiday_ot_multiplier: number
          leave_days: number
          non_employed_days: number
          ot_hours: number
          ot_multiplier: number
          present_days: number
          review_days: number
          std_hours_per_day: number
          undertime_minutes: number
          worked_hours: number
        }[]
      }
      rpc_period_leave_summary: {
        Args: {
          p_employee_ids?: string[]
          p_period_end: string
          p_period_start: string
        }
        Returns: {
          days_taken: number
          employee_id: string
          leave_code: string
          leave_name: string
          treatment: string
        }[]
      }
      rpc_post_bonus_provision: { Args: { p_period: string }; Returns: Json }
      rpc_post_gratuity_provision: { Args: { p_period: string }; Returns: Json }
      rpc_post_loan_advance: {
        Args: { p_bank_account_id: string; p_loan_id: string }
        Returns: Json
      }
      rpc_suggest_arrears: { Args: { p_employee_id: string }; Returns: number }
      rpc_trial_balance: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_group_by?: string
          p_include_inactive?: boolean
          p_include_zero?: boolean
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: string
          audit_opening: number
          closing: number
          group_key: string
          group_label: string
          group_sort: string
          has_audit_row: boolean
          ledger_opening: number
          opening_variance: number
          period_credit: number
          period_debit: number
        }[]
      }
      rpc_void_payroll_run: {
        Args: { p_reason?: string; p_run_id: string }
        Returns: Json
      }
      rpc_ytd_payroll: {
        Args: { p_before: string; p_employee_ids: string[] }
        Returns: {
          employee_id: string
          ytd_gross: number
          ytd_paye: number
        }[]
      }
      seed_default_leave_types: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_default_payroll_engine: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_fixed_asset_coa_accounts: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_inventory_coa_accounts: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_tax_engine_for_tenant: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      settle_leave_for_period: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_run_id?: string
        }
        Returns: Json
      }
      setup_bank_import_chart: { Args: never; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      signup_provision: {
        Args: {
          p_company_name: string
          p_first_name: string
          p_last_name: string
        }
        Returns: string
      }
      sl_fiscal_year_bounds: {
        Args: { p_on: string }
        Returns: {
          fy_end: string
          fy_name: string
          fy_start: string
        }[]
      }
      start_stock_count: {
        Args: { p_count_id: string; p_item_ids?: string[] }
        Returns: Json
      }
      submit_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      sync_bank_batch_transactions: {
        Args: { p_batch_id: string }
        Returns: number
      }
      undo_bank_statement_batch: {
        Args: { p_batch_id: string; p_reason?: string }
        Returns: Json
      }
      validate_pcv_line_account: {
        Args: {
          p_account_id: string
          p_petty_cash_account_id: string
          p_voucher_date: string
        }
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
      verify_bank_import_batch: { Args: { p_batch_id: string }; Returns: Json }
      void_bank_statement_batch: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: Json
      }
      void_tax_remittance: { Args: { p_remittance_id: string }; Returns: Json }
    }
    Enums: {
      ap_transaction_status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "WRITTEN_OFF"
      ap_transaction_type:
        | "INVOICE"
        | "DEBIT_NOTE"
        | "PAYMENT"
        | "PREPAYMENT"
        | "ADJUSTMENT"
      ar_transaction_status: "OPEN" | "PARTIALLY_PAID" | "PAID" | "WRITTEN_OFF"
      ar_transaction_type:
        | "INVOICE"
        | "CREDIT_NOTE"
        | "PAYMENT"
        | "WRITE_OFF"
        | "ADJUSTMENT"
        | "PAYMENT_REVERSAL"
        | "CREDIT_NOTE_REVERSAL"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ap_transaction_status: ["OPEN", "PARTIALLY_PAID", "PAID", "WRITTEN_OFF"],
      ap_transaction_type: [
        "INVOICE",
        "DEBIT_NOTE",
        "PAYMENT",
        "PREPAYMENT",
        "ADJUSTMENT",
      ],
      ar_transaction_status: ["OPEN", "PARTIALLY_PAID", "PAID", "WRITTEN_OFF"],
      ar_transaction_type: [
        "INVOICE",
        "CREDIT_NOTE",
        "PAYMENT",
        "WRITE_OFF",
        "ADJUSTMENT",
        "PAYMENT_REVERSAL",
        "CREDIT_NOTE_REVERSAL",
      ],
    },
  },
} as const
