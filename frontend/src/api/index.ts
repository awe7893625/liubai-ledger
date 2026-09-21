// API client — talks to FastAPI backend

import type {
  Account,
  Transaction,
  Category,
  Budget,
  OverviewSummary,
  CategoryBreakdown,
  CaptureInput,
  CaptureResult,
} from "../types";

const BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Accounts
  listAccounts: (init?: RequestInit) => request<Account[]>("/accounts", init),
  getAccount: (id: string) => request<Account>(`/accounts/${id}`),
  createAccount: (body: Partial<Account>) =>
    request<Account>("/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAccount: (id: string, body: Partial<Account>) =>
    request<Account>(`/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Transactions
  listTransactions: (params?: { account?: string; month?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.account) q.set("funding_account", params.account);
    if (params?.month) q.set("month", params.month);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<Transaction[]>(`/transactions?${q.toString()}`);
  },
  getTransaction: (id: string) =>
    request<Transaction>(`/transactions/${id}`),
  createTransaction: (body: Partial<Transaction>) =>
    request<Transaction>("/transactions", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateTransaction: (id: string, body: Partial<Transaction>) =>
    request<Transaction>(`/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTransaction: (id: string) =>
    request<void>(`/transactions/${id}`, { method: "DELETE" }),

  // Categories
  listCategories: (init?: RequestInit) => request<Category[]>("/categories", init),
  createCategory: (body: { name: string; slug?: string }) =>
    request<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Budgets
  getBudget: (month?: string) =>
    request<Budget>("/budgets" + (month ? `?month=${month}` : "")),
  upsertBudget: (body: Partial<Budget>) =>
    request<Budget>("/budgets", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchBudget: (body: Partial<Budget>, id: string) =>
    request<Budget>(`/budgets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Overview
  getOverview: (month?: string, opts?: { today?: string }) => {
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (opts?.today) q.set("today", opts.today);
    const qs = q.toString();
    return request<OverviewSummary>("/overview" + (qs ? `?${qs}` : ""));
  },

  // Budgets — per-category spend vs limit (T32 source)
  getCategoriesSummary: (month?: string) =>
    request<CategoryBreakdown[]>(
      "/budgets/categories/summary" + (month ? `?month=${month}` : "")
    ),

  upsertCategoryLimit: (budgetId: string, body: { category_id: string; category_limit_minor: number }) =>
    request<CategoryBreakdown>(`/budgets/${budgetId}/categories`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // Capture
  capture: (body: CaptureInput) =>
    request<CaptureResult>("/capture", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // AI 助理：收據圖片／文字 → 結構化記帳欄位
  aiParse: (body: { text?: string; image_b64?: string }) =>
    request<{
      ok: boolean;
      engine?: string;
      error?: string;
      amount_minor?: number;
      kind?: "expense" | "income";
      date?: string;
      merchant?: string;
      category?: string;
      account?: string | null;
      notes?: string;
    }>("/ai/parse", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getInsights: (month?: string) =>
    request<{
      daily_avg_this_month: number;
      total_spent_minor: number;
      category_totals: { category_id: string; name: string; total_minor: number; count: number }[];
      account_totals: { account_id: string; name: string; total_minor: number; count: number }[];
      category_trend: Record<string, Record<string, number>>;
      top_merchants: { merchant: string; total_minor: number; count: number }[];
      burn_rate: number | null;
      budget_configured: boolean;
      window: { month: string; start: string; end: string };
    }>("/insights" + (month ? `?month=${month}` : "")),

  aiAsk: (question: string, month?: string) =>
    request<{ ok: boolean; engine?: string; answer?: string; error?: string }>(
      "/ai/ask",
      {
        method: "POST",
        body: JSON.stringify({ question, month }),
      },
    ),

  listTransactionsPaged: (params?: {
    account?: string;
    month?: string;
    status?: string;
    limit?: number;
  }, init?: RequestInit) => {
    const q = new URLSearchParams();
    if (params?.account) q.set("funding_account", params.account);
    if (params?.month) q.set("month", params.month);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    return request<Transaction[]>(`/transactions?${q.toString()}`, init);
  },
};
