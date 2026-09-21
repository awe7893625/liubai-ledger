// Ledger Personal Finance — Core Type Definitions

export type AccountType = "credit_card" | "cash" | "bank_account" | "other";
export type TxStatus = "pending" | "confirmed" | "archived" | "duplicate";
export type TxSource = "manual" | "telegram" | "email" | "statement" | "sync" | "capture" | "sms";
export type TxKind = "expense" | "income" | "refund" | "transfer" | "unknown";

export interface Account {
   id: string;
   user_id: string;
   type: AccountType;
   issuer: string | null;
   nickname: string;
   last4: string | null;
   currency: string;
   is_active: number;
   sort_order: number;
   metadata: Record<string, unknown>;
   tx_count: number;
   spent_this_month: number;
   created_at: string;
   updated_at: string;
}

export interface Category {
   id: string;
   user_id: string;
   name: string;
   slug: string;
   is_active: number;
   sort_order: number;
   metadata: Record<string, unknown>;
   created_at: string;
   updated_at: string;
}

export interface Transaction {
   id: string;
   user_id: string;
   funding_account_id: string;
   amount: number; // minor units
   currency: string;
   date: string; // YYYY-MM-DD
   occurred_at: string; // ISO 8601 UTC
   description: string | null;
   merchant: string | null;
   merchant_normalized: string | null;
   category_id: string | null;
   subcategory: string | null;
   tag: string | null;
   source: TxSource;
   status: TxStatus;
   kind: TxKind;
   is_recurring: number;
   notes: string | null;
   created_at: string;
   updated_at: string;
}

export interface Budget {
   id: string;
   user_id: string;
   period_month: string; // YYYY-MM
   total_limit_minor: number;
   safety_buffer_minor: number;
   metadata: Record<string, unknown>;
   created_at: string;
   updated_at: string;
   // computed fields
   spent_minor: number;
   remaining_minor: number;
   pct_used: number;
   forecast_end_minor: number;
   safe_to_spend_minor: number;
}

export interface BudgetCategory {
   id: string;
   budget_id: string;
   category_id: string;
   category_limit_minor: number;
   safety_buffer_minor: number;
   // computed
   spent_minor: number;
   remaining_minor: number;
   pct_used: number;
}

export interface OverviewSummary {
   month: string;
   period_start: string;
   period_end: string;
   income_minor: number;
   expense_minor: number;
   net_minor: number;
   budget_limit_minor: number;
   budget_spent_minor: number;
   budget_remaining_minor: number;
   budget_pct_used: number;
   days_elapsed: number;
   days_total: number;
   days_remaining: number;
   pace: PacePoint[];
   forecast_end_minor: number;
   safe_to_spend_minor: number;
   safe_to_spend_today_minor: number;
   reserved_minor: number;
   is_over_budget: boolean;
   recent_transactions: RecentTransaction[];
   transactions_count: number;
   confirmed_count: number;
   pending_count: number;
}

/** One point of the dashboard spend-pace series (from /api/overview `pace`). */
export interface PacePoint {
   day: number;
   date: string;
   /** Cumulative confirmed net spend up to this day; null for future days. */
   actual_minor: number | null;
   /** Ideal cumulative budget pace: limit * day / days_total. */
   pace_minor: number;
}

/** Per-category spend vs category budget (/api/budgets/categories/summary). */
export interface CategoryBreakdown {
   category_id: string;
   name: string;
   slug: string;
   spent_minor: number;
   limit_minor: number;
   remaining_minor: number | null;
   pct_used: number | null;
   over_budget: boolean;
}

export interface RecentTransaction {
   id: string;
   amount: number;
   currency: string;
   date: string;
   occurred_at: string;
   description: string | null;
   merchant: string | null;
   category_id: string | null;
   category_name: string | null;
   account_nickname: string | null;
   status: TxStatus;
   source: TxSource;
}

// Capture types
export interface CaptureInput {
   raw_text: string;
   funding_account_id?: string;
}

export interface CaptureResult {
   amount: number; // minor units
   currency: string;
   date: string;
   merchant: string;
   merchant_normalized: string;
   category_id: string;
   category: string;
   subcategory: string | null;
   tag: string | null;
   is_recurring: boolean;
   confidence: number;
   source: TxSource;
   notes: string;
   requires_confirm: boolean;
}

// Toast / UI state
export type ToastType = "success" | "error" | "info" | "warn";

export interface Toast {
   id: string;
   type: ToastType;
   message: string;
}

// API types
export interface ApiResponse<T> {
   data: T;
   error?: string;
}
