import { create } from "zustand";
import type {
   Account,
   Transaction,
   Category,
   Budget,
   OverviewSummary,
   CategoryBreakdown,
   Toast,
   CaptureResult,
} from "../types";

export interface LoadState {
   status: "loading" | "loaded" | "error";
   error?: string;
}

interface AppState {
   // Data
   accounts: Account[];
   transactions: Transaction[];
   categories: Category[];
   budget: Budget | null;
   overview: OverviewSummary | null;
   categoriesBd: CategoryBreakdown[];

   // UI
   toasts: Toast[];
   captureDraft: string;
   selectedMonth: string;
   overviewState: LoadState;
   accountsState: LoadState;
   catBdState: LoadState;

   // Actions
   loadAccounts: () => Promise<void>;
   loadOverview: () => Promise<void>;
   loadCategories: () => Promise<void>;
   loadCategoriesSummary: () => Promise<void>;
   loadTransactions: () => Promise<void>;
   addTransaction: (input: Partial<Transaction>) => Promise<void>;
   captureText: (text: string, account?: string) => Promise<CaptureResult | null>;
   pushToast: (type: Toast["type"], message: string) => void;
   removeToast: (id: string) => void;
   setCaptureDraft: (text: string) => void;
   setSelectedMonth: (month: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
   accounts: [],
   transactions: [],
   categories: [],
   budget: null,
   overview: null,
   categoriesBd: [],
   toasts: [],
   captureDraft: "",
   selectedMonth: new Date().toISOString().slice(0, 7),
   overviewState: { status: "loading" },
   accountsState: { status: "loading" },
   catBdState: { status: "loading" },

   loadAccounts: async () => {
      set({ accountsState: { status: "loading" } });
      try {
         const { api } = await import("../api");
         const data = await api.listAccounts();
         set({ accounts: data, accountsState: { status: "loaded" } });
      } catch (e: unknown) {
         const msg = e instanceof Error ? e.message : "unknown error";
         set({ accountsState: { status: "error", error: msg } });
      }
   },
   loadOverview: async () => {
      set({ overviewState: { status: "loading" } });
      try {
         const { api } = await import("../api");
         const month = get().selectedMonth;
         const data = await api.getOverview(month);
         set({ overview: data, overviewState: { status: "loaded" } });
      } catch (e: unknown) {
         const msg = e instanceof Error ? e.message : "unknown error";
         set({ overviewState: { status: "error", error: msg } });
      }
   },
   loadCategories: async () => {
      try {
         const { api } = await import("../api");
         const data = await api.listCategories();
         set({ categories: data });
      } catch {
         /* non-critical */
      }
   },
   loadCategoriesSummary: async () => {
      set({ catBdState: { status: "loading" } });
      try {
         const { api } = await import("../api");
         const month = get().selectedMonth;
         const data = await api.getCategoriesSummary(month);
         set({ categoriesBd: data, catBdState: { status: "loaded" } });
      } catch (e: unknown) {
         const msg = e instanceof Error ? e.message : "unknown error";
         set({ catBdState: { status: "error", error: msg } });
      }
   },
   loadTransactions: async () => {
      try {
         const { api } = await import("../api");
         const month = get().selectedMonth;
         const data = await api.listTransactions({ month });
         set({ transactions: data });
      } catch {
         /* non-critical */
      }
   },
   addTransaction: async (input) => {
      try {
         const { api } = await import("../api");
         const tx = await api.createTransaction(input);
         set((s) => ({
            transactions: [tx, ...s.transactions],
            toasts: [
               ...s.toasts,
               { id: Date.now().toString(), type: "success", message: "Logged" },
            ],
         }));
      } catch (e: unknown) {
         const msg = e instanceof Error ? e.message : "unknown error";
         set((s) => ({
            toasts: [
               ...s.toasts,
               { id: Date.now().toString(), type: "error", message: `Failed: ${msg}` },
            ],
         }));
      }
   },
   captureText: async (text, account) => {
      const { api } = await import("../api");
      try {
         const result = await api.capture({ raw_text: text, funding_account_id: account });
         return result;
      } catch {
         return null;
      }
   },
   pushToast: (type, message) =>
      set((s) => ({
         toasts: [
            ...s.toasts,
            { id: Date.now().toString(), type, message },
         ],
      })),
   removeToast: (id) =>
      set((s) => ({
         toasts: s.toasts.filter((t) => t.id !== id),
      })),
   setCaptureDraft: (text) => set({ captureDraft: text }),
   setSelectedMonth: (month) => set({ selectedMonth: month }),
}));
