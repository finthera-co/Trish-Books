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
          id: string
          is_active: boolean
          parent_account_id: string | null
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
          id?: string
          is_active?: boolean
          parent_account_id?: string | null
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
          id?: string
          is_active?: boolean
          parent_account_id?: string | null
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
      bank_reconciliations: {
        Row: {
          bank_account_id: string
          beginning_balance: number
          cleared_balance: number
          created_at: string
          difference: number
          id: string
          interest_earned: number | null
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
      budget_items: {
        Row: {
          account_id: string
          allocated_amount: number
          budget_id: string
          id: string
        }
        Insert: {
          account_id: string
          allocated_amount?: number
          budget_id: string
          id?: string
        }
        Update: {
          account_id?: string
          allocated_amount?: number
          budget_id?: string
          id?: string
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
          period_end: string
          period_start: string
          tenant_id: string
          total_budget: number
        }
        Insert: {
          created_at?: string
          department: string
          id?: string
          period_end: string
          period_start: string
          tenant_id: string
          total_budget?: number
        }
        Update: {
          created_at?: string
          department?: string
          id?: string
          period_end?: string
          period_start?: string
          tenant_id?: string
          total_budget?: number
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
          email: string | null
          id: string
          name: string
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
      invoice_items: {
        Row: {
          description: string | null
          id: string
          invoice_id: string
          product_id: string | null
          quantity: number
          tax_id: string | null
          total: number
          unit_price: number
        }
        Insert: {
          description?: string | null
          id?: string
          invoice_id: string
          product_id?: string | null
          quantity?: number
          tax_id?: string | null
          total?: number
          unit_price?: number
        }
        Update: {
          description?: string | null
          id?: string
          invoice_id?: string
          product_id?: string | null
          quantity?: number
          tax_id?: string | null
          total?: number
          unit_price?: number
        }
        Relationships: [
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
      invoices: {
        Row: {
          created_at: string
          currency: string
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          status: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          status?: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          id: string
          reference: string | null
          reversal_of: string | null
          status: string
          tenant_id: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          entry_date?: string
          id?: string
          reference?: string | null
          reversal_of?: string | null
          status?: string
          tenant_id: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          id?: string
          reference?: string | null
          reversal_of?: string | null
          status?: string
          tenant_id?: string
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
          cost_center_id: string | null
          credit: number
          debit: number
          id: string
          journal_entry_id: string
        }
        Insert: {
          account_id: string
          cost_center_id?: string | null
          credit?: number
          debit?: number
          id?: string
          journal_entry_id: string
        }
        Update: {
          account_id?: string
          cost_center_id?: string | null
          credit?: number
          debit?: number
          id?: string
          journal_entry_id?: string
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
      opening_balances: {
        Row: {
          account_id: string
          balance: number
          created_at: string
          fiscal_period_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          balance?: number
          created_at?: string
          fiscal_period_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          balance?: number
          created_at?: string
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
          id: string
          invoice_id: string
          payment_date: string
          payment_method: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          id?: string
          invoice_id: string
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          id?: string
          invoice_id?: string
          payment_date?: string
          payment_method?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_received_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
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
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          pay_schedule_id: string | null
          payment_date: string | null
          period_end: string
          period_start: string
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
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          pay_schedule_id?: string | null
          payment_date?: string | null
          period_end: string
          period_start: string
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
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          pay_schedule_id?: string | null
          payment_date?: string | null
          period_end?: string
          period_start?: string
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
            foreignKeyName: "payroll_runs_created_by_fkey"
            columns: ["created_by"]
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
          account_name: string
          balance: number
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          account_name: string
          balance?: number
          created_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          account_name?: string
          balance?: number
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          petty_cash_account_id: string
          receipt_url: string | null
          transaction_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          petty_cash_account_id: string
          receipt_url?: string | null
          transaction_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          petty_cash_account_id?: string
          receipt_url?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_transactions_petty_cash_account_id_fkey"
            columns: ["petty_cash_account_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_accounts"
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
          created_at: string
          description: string | null
          id: string
          income_account_id: string | null
          name: string
          price: number
          tax_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          income_account_id?: string | null
          name: string
          price?: number
          tax_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          income_account_id?: string | null
          name?: string
          price?: number
          tax_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_income_account_id_fkey"
            columns: ["income_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
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
          last_name: string
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
          last_name: string
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
          last_name?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_voucher_number: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      get_user_permission: {
        Args: { p_module: string; p_user_id: string }
        Returns: string
      }
      get_user_role_name: { Args: never; Returns: string }
      get_user_tenant_id: { Args: never; Returns: string }
      is_primary_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
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
