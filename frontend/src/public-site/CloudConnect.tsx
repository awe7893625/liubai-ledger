import { createClient, type Session } from "@supabase/supabase-js";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  CreditCard,
  Download,
  Home,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  Settings2,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./site.css";
import { PaymentSettings } from "./PaymentSettings";
import { AccountSettings } from "./AccountSettings";
import { defaultPreferences } from "./cloud-preferences";
import type { CloudPreferences } from "./cloud-preferences";
import "./app-theme.css";
import { SpendingInsights } from "./SpendingInsights";
import { MonthlyPlanner } from "./MonthlyPlanner";
import { LedgerExplore } from "./LedgerExplore";
import type { QuickDraft } from "./explore-data";
import { TransactionEditor } from "./TransactionEditor";
import { ShortcutOnboarding } from "./ShortcutOnboarding";
import { currentMonth, ledgerDay, summarizeMonth, filterLedger, ledgerCsv, loadAllLedgerPages, retryRequest } from "./ledger-data";
import "./launch.css";
import "./mobile-polish.css";
import "./edit-transaction.css";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? "";
const CLOUD_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);
const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)?.trim() ?? "";
const SHORTCUT_NAME = "留白手動記帳";

type GoogleCredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }): void;
          renderButton(element: HTMLElement, options: Record<string, string>): void;
        };
      };
    };
  }
}

const supabase = CLOUD_READY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

type Device = {
  id: string;
  name: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type Account = {
  id: string;
  name: string;
  type: string;
  issuer: string | null;
  currency: string;
};

type Category = {
  id: string;
  name: string;
  slug: string;
};

type PairStart = {
  pair_ticket: string;
  expires_at: string;
};

type CloudTransaction = {
  id: string;
  request_id: string;
  source: "apple_pay" | "manual" | "notification" | "statement" | "capture" | "email";
  amount_minor: number | null;
  currency: string;
  merchant: string | null;
  card_label: string | null;
  status: "pending" | "confirmed" | "duplicate" | "error";
  occurred_at: string;
  account_id: string | null;
  category_id: string | null;
  note: string | null;
  legacy_date?: string | null;
  legacy_kind?: "expense" | "income" | "refund" | "transfer" | "unknown" | null;
  legacy_description?: string | null;
  updated_at?: string;
};

type AuthSessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
};

type PublicAuthResponse = {
  ok: boolean;
  username: string;
  session?: AuthSessionPayload;
  recovery_code?: string;
  error?: string;
};

type BootstrapResponse = {
  ok: boolean;
  profile: {
    user_id: string;
    locale: string;
    timezone: string;
    plan: "free";
  };
  accounts: Account[];
  categories: Category[];
  preferences: CloudPreferences;
};

function shortcutUrl(ticket: string): string {
  const success = `${window.location.origin}/connect?paired=1`;
  const params = new URLSearchParams({
    name: SHORTCUT_NAME,
    input: "text",
    text: `pair:${ticket}`,
    "x-success": success,
    "x-cancel": `${window.location.origin}/connect`,
  });
  return `shortcuts://x-callback-url/run-shortcut?${params.toString()}`;
}

function timeLabel(value: string | null): string {
  if (!value) return "尚未送出交易";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function dateTimeLocalValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function moneyFromMinor(amountMinor: number, currency = "TWD"): string {
  const amount = amountMinor / 100;
  const sign = amount < 0 ? "−" : amount > 0 ? "+" : "";
  const absolute = Math.abs(amount).toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return currency === "TWD" ? `${sign}NT$${absolute}` : `${sign}${currency} ${absolute}`;
}

function absoluteMoneyFromMinor(amountMinor: number, currency = "TWD"): string {
  const amount = Math.abs(amountMinor) / 100;
  const absolute = amount.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return currency === "TWD" ? `NT$${absolute}` : `${currency} ${absolute}`;
}

function moneyLabel(tx: CloudTransaction): string {
  if (tx.amount_minor === null) return "待補金額";
  return moneyFromMinor(tx.amount_minor, tx.currency);
}

function transactionTimeLabel(tx: CloudTransaction): string {
  if (tx.legacy_date) return tx.legacy_date.replace(/-/g, "/");
  return timeLabel(tx.occurred_at);
}

function statusLabel(status: CloudTransaction["status"]): string {
  return status === "confirmed" ? "已記帳" : status === "pending" ? "待確認" : status === "duplicate" ? "重複" : "需處理";
}

function sourceLabel(source: CloudTransaction["source"]): string {
  if (source === "apple_pay") return "Apple Pay";
  if (source === "manual") return "手動";
  if (source === "notification") return "通知";
  if (source === "capture") return "舊帳本記帳";
  if (source === "email") return "郵件入帳";
  if (source === "statement") return "帳單匯入";
  return "其他";
}

async function timedFetch(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25000);
  try { return await fetch(path, { ...init, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new Error("連線逾時，尚未確認結果。請保留內容並重試。");
    throw error;
  } finally { window.clearTimeout(timer); }
}

async function publicRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await timedFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Cloud API ${response.status}`);
  return data as T;
}

async function cloudRequest<T>(
  path: string,
  session: Session,
  init: RequestInit = {},
): Promise<T> {
  const response = await timedFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Cloud API ${response.status}`);
  return data as T;
}

export function CloudConnect() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [preferences, setPreferences] = useState<CloudPreferences>(defaultPreferences);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const preferencesApplied = useRef(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const sessionUserRef = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const submitLock = useRef(false);
  const manualRequest = useRef<ReturnType<typeof retryRequest<Record<string, unknown>>> | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup" | "recover">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleEnabled = Boolean(GOOGLE_WEB_CLIENT_ID);
  const [settingsSection, setSettingsSection] = useState<"general" | "shortcuts">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("section") === "shortcuts" || params.get("paired") === "1" ? "shortcuts" : "general";
  });
  const [activeTab, setActiveTab] = useState<"home" | "capture" | "transactions" | "explore" | "settings">(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (params.get("paired") === "1") return "settings";
    return tab === "capture" || tab === "transactions" || tab === "explore" || tab === "settings" ? tab : "home";
  });
  const [ticket, setTicket] = useState<PairStart | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [transactions, setTransactions] = useState<CloudTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [amount, setAmount] = useState("");
  const [quickDraftActive, setQuickDraftActive] = useState(false);
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [overviewMonth, setOverviewMonth] = useState(currentMonth);
  const [overviewCurrency, setOverviewCurrency] = useState("TWD");
  const [filterMonth, setFilterMonth] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);
  const [editing, setEditing] = useState<CloudTransaction | null>(null);

  const [merchant, setMerchant] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalValue);
  const [note, setNote] = useState("");
  const paired = useMemo(() => new URLSearchParams(window.location.search).get("paired") === "1", []);
  const openShortcutSettings = () => { setSettingsSection("shortcuts"); setActiveTab("settings"); };

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const activeDevices = useMemo(() => devices.filter((device) => !device.revoked_at), [devices]);
  const summary = useMemo(() => summarizeMonth(transactions, overviewMonth, overviewCurrency), [transactions, overviewMonth, overviewCurrency]);
  const months = useMemo(() => {
    const [year, month] = currentMonth().split("-").map(Number);
    const planningMonths = Array.from({ length: 25 }, (_, index) => new Date(Date.UTC(year, month - 1 + index - 12, 1)).toISOString().slice(0, 7));
    return [...new Set([...planningMonths, ...transactions.map((tx) => ledgerDay(tx).slice(0, 7)).filter(Boolean)])].sort().reverse();
  }, [transactions]);
  const currencies = useMemo(() => [...new Set(["TWD", preferences.home_currency, ...accounts.map((a) => a.currency.trim()), ...transactions.map((tx) => tx.currency.trim())])].sort(), [transactions, accounts, preferences.home_currency]);
  const filteredTransactions = useMemo(() => filterLedger(transactions, filterMonth, search, accountById, categoryById).filter((tx) => (!selectedAccount || tx.account_id === selectedAccount) && (!selectedCategory || (selectedCategory === "__uncategorized__" ? !tx.category_id : tx.category_id === selectedCategory)) && (!selectedStatus || tx.status === selectedStatus)), [transactions, filterMonth, search, accountById, categoryById, selectedAccount, selectedCategory, selectedStatus]);
  const captureCurrency = accountById.get(accountId)?.currency.trim() || "TWD";
  const recentTransactions = useMemo(() => transactions.slice(0, 5), [transactions]);
  const displayName = useMemo(() => {
    const raw = preferences.display_name || session?.user.user_metadata?.display_name || session?.user.user_metadata?.username;
    return typeof raw === "string" && raw.trim() ? raw.trim() : "我的帳本";
  }, [session, preferences.display_name]);
  const resolvedTheme = preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!session) return;
    document.documentElement.dataset.ledgerTheme = resolvedTheme;
    return () => { delete document.documentElement.dataset.ledgerTheme; };
  }, [session, resolvedTheme]);
  const preferencesChanged = (next: CloudPreferences) => {
    setPreferences(next); setOverviewCurrency(next.home_currency);
    if (!amount.trim() && !merchant.trim()) {
      setAccountId(next.default_account_id || accounts[0]?.id || "");
      setCategoryId(next.default_category_id || categories.find((c) => c.slug === "other")?.id || "");
    }
  };

  const loadCloudData = useCallback(async () => {
    if (!supabase || !session) return;
    const client = supabase;
    const owner = session.user.id;
    const generation = ++loadGeneration.current;
    const current = () => sessionUserRef.current === owner && generation === loadGeneration.current;
    setDataLoading(true);
    setDataError("");
    try {
      const bootstrap = await cloudRequest<BootstrapResponse>("/api/v2/bootstrap", session, { method: "POST", body: "{}" });
      const [deviceResult, rows] = await Promise.all([
        cloudRequest<{ ok: boolean; devices: Device[] }>("/api/v2/devices", session),
        loadAllLedgerPages<CloudTransaction>(async (offset, size) => {
          if (!current()) throw new Error("登入帳號已變更。");
          const result = await client.from("ledger_transactions")
            .select("id,request_id,source,amount_minor,currency,merchant,card_label,status,occurred_at,account_id,category_id,note,legacy_date,legacy_kind,legacy_description,updated_at", { count: "exact" })
            .eq("user_id", owner)
            .order("occurred_at", { ascending: false }).order("id", { ascending: false })
            .range(offset, offset + size - 1);
          if (result.error) throw new Error("交易載入失敗，請檢查網路後重試。");
          return { rows: (result.data ?? []) as CloudTransaction[], total: result.count ?? -1 };
        }),
      ]);
      if (!current()) return;
      setAccounts(bootstrap.accounts ?? []);
      setCategories(bootstrap.categories ?? []);
      const prefs = bootstrap.preferences || defaultPreferences;
      setPreferences(prefs);
      if (!preferencesApplied.current) {
        setOverviewCurrency(prefs.home_currency); preferencesApplied.current = true;
      }
      setAccountId((value) => bootstrap.accounts.some((a) => a.id === value) ? value : prefs.default_account_id || bootstrap.accounts[0]?.id || "");
      setCategoryId((value) => bootstrap.categories.some((c) => c.id === value) ? value : prefs.default_category_id || bootstrap.categories.find((c) => c.slug === "other")?.id || "");
      setDevices(deviceResult.devices ?? []);
      setTransactions(rows);
      setLoadedAt(new Date().toISOString());
    } catch (error) {
      if (current()) setDataError(error instanceof Error ? error.message : "帳本載入失敗，請重試。");
      throw error;
    } finally {
      if (current()) setDataLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!supabase) { setAuthChecking(false); return; }
    let disposed = false;
    let authEventSeen = false;
    const accept = (next: Session | null) => {
      if (disposed) return;
      const nextId = next?.user.id ?? null;
      if (sessionUserRef.current !== nextId) {
        sessionUserRef.current = nextId;
        ++loadGeneration.current; // Old in-flight responses cannot re-populate another account.
        setTransactions([]); setAccounts([]); setCategories([]); setDevices([]);
        setAmount(""); setQuickDraftActive(false); setMerchant(""); setNote(""); setAccountId(""); setCategoryId("");
        setTicket(null); setIssuedRecoveryCode(""); setMessage(""); setDataError("");
        setLoadedAt(null); setDataLoading(Boolean(next)); setBusy(false);
        setSearch(""); setFilterMonth(""); setVisibleCount(100);
        setSelectedAccount(""); setSelectedCategory(""); setSelectedStatus("");
        setOverviewMonth(currentMonth()); setOverviewCurrency("TWD");
        setPreferences(defaultPreferences); preferencesApplied.current = false;
        setEditing(null);
        manualRequest.current = null; submitLock.current = false;
      }
      setSession(next); setAuthChecking(false);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { authEventSeen = true; accept(next); });
    void supabase.auth.getSession().then(({ data: initial }) => { if (!authEventSeen) accept(initial.session); }).catch(() => {
      if (!disposed) { setAuthChecking(false); setMessage("無法確認登入，請重新登入。"); }
    });
    return () => { disposed = true; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!googleEnabled || !supabase || session) return;
    let cancelled = false;

    const handleGoogleCredential = async (response: GoogleCredentialResponse) => {
      if (!response.credential || cancelled) return;
      setGoogleSigningIn(true);
      setBusy(true);
      setMessage("");
      try {
        const data = await publicRequest<PublicAuthResponse>("/api/v2/auth/google", {
          credential: response.credential,
        });
        if (!data.session) throw new Error("沒有取得 Google 登入 Session");
        const { error } = await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        if (error) throw error;
        setMessage("✅ 已使用 Google 登入。");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Google 登入失敗，請稍後重試。");
      } finally {
        setBusy(false);
        setGoogleSigningIn(false);
      }
    };

    const renderGoogle = () => {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        callback: (response) => void handleGoogleCredential(response),
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "continue_with",
        logo_alignment: "left",
        width: "320",
      });
      setGoogleReady(true);
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-liubai-google="true"]');
    if (window.google) {
      renderGoogle();
    } else if (existing) {
      existing.addEventListener("load", renderGoogle, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.liubaiGoogle = "true";
      script.addEventListener("load", renderGoogle, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      existing?.removeEventListener("load", renderGoogle);
    };
  }, [googleEnabled, session]);

  useEffect(() => {
    if (!session) return;
    void loadCloudData().catch(() => { /* Persistent inline error, never an empty-ledger success. */ });
  }, [session, loadCloudData]);

  useEffect(() => { window.scrollTo(0, 0); }, [activeTab, session?.user.id]);

  useEffect(() => {
    if (!/^(✅|已匯出|交易已刪除|復原碼已複製)/.test(message)) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const authenticate = async () => {
    if (!supabase || !username.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      if (authMode === "recover") {
        const data = await publicRequest<PublicAuthResponse>("/api/v2/auth/recover", {
          username,
          recovery_code: recoveryCode,
          new_password: newPassword,
        });
        if (!data.recovery_code) throw new Error("沒有取得新的復原碼");
        setIssuedRecoveryCode(data.recovery_code);
        setRecoveryCode("");
        setNewPassword("");
        setPassword("");
        setAuthMode("login");
        setMessage("✅ 密碼已更新。請保存新的復原碼，再用新密碼登入。");
        return;
      }

      const data = await publicRequest<PublicAuthResponse>(
        authMode === "signup" ? "/api/v2/auth/signup" : "/api/v2/auth/login",
        { username, password },
      );
      if (!data.session) throw new Error("沒有取得登入 Session");
      const { error } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (error) throw error;
      if (data.recovery_code) setIssuedRecoveryCode(data.recovery_code);
      setPassword("");
      setMessage(authMode === "signup" ? "✅ 免費帳本已建立。請先保存復原碼。" : "✅ 已登入。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登入失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  const copyRecoveryCode = async () => {
    if (!issuedRecoveryCode) return;
    try {
      await navigator.clipboard.writeText(issuedRecoveryCode);
      setMessage("復原碼已複製。");
    } catch {
      setMessage("無法自動複製，請長按復原碼手動複製。");
    }
  };

  const downloadRecoveryCode = () => {
    if (!issuedRecoveryCode) return;
    const blob = new Blob([
      `留白 Ledger 復原碼\n\n帳號：${username.trim().toLowerCase()}\n復原碼：${issuedRecoveryCode}\n\n請離線保存。此碼可重設密碼；不要分享給他人。\n`,
    ], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "liubai-ledger-recovery.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const submitManual = async () => {
    if (!session || submitLock.current || !amount.trim() || !merchant.trim()) return;
    if (quickDraftActive && !accountId) { setMessage("請先選擇這筆草稿的付款帳戶。"); return; }
    const value = Number(amount.trim());
    const parsedDate = new Date(occurredAt);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100))) {
      setMessage("請輸入大於 0、最多兩位小數的金額。"); return;
    }
    if (Number.isNaN(parsedDate.getTime())) { setMessage("請選擇有效的交易時間。"); return; }
    const owner = session.user.id;
    submitLock.current = true;
    setBusy(true); setMessage("");
    const payload = { amount: value, merchant: merchant.trim(), account_id: accountId || null,
      category_id: categoryId || null, occurred_at: parsedDate.toISOString(), note, direction, currency: captureCurrency };
    manualRequest.current = retryRequest(manualRequest.current, payload, () => `web_${crypto.randomUUID()}`);
    try {
      const result = await cloudRequest<{ ok: boolean; duplicate: boolean; transaction?: { id: string } }>("/api/v2/transactions", session, {
        method: "POST", body: JSON.stringify({ ...manualRequest.current.body, request_id: manualRequest.current.requestId }),
      });
      if (!result.ok || !result.transaction?.id) throw new Error("後端尚未確認入帳，請保留內容並重試。");
      if (sessionUserRef.current !== owner) return;
      manualRequest.current = null;
      setAmount(""); setQuickDraftActive(false); setMerchant(""); setNote(""); setOccurredAt(dateTimeLocalValue());
      setMessage(result.duplicate ? "✅ 這筆已記帳，沒有重複新增。" : "✅ 已記帳。");
      setActiveTab("home");
      await loadCloudData().catch(() => setMessage("✅ 已入帳，但列表更新失敗。請重新整理，不必再記一次。"));
    } catch (error) {
      if (sessionUserRef.current === owner) setMessage(error instanceof Error ? `尚未確認：${error.message}` : "尚未確認入帳，請保留內容並重試。");
    } finally {
      if (sessionUserRef.current === owner) { submitLock.current = false; setBusy(false); }
    }
  };

  const saveEdit = async (patch: Record<string, unknown>) => {
    if (!session || !editing || busy) throw new Error("請等候目前操作完成。");
    const owner = session.user.id; const id = editing.id;
    setBusy(true); setMessage("");
    try {
      const result = await cloudRequest<{ ok: boolean; transaction?: { id: string } }>("/api/v2/transactions", session, {
        method: "PATCH", body: JSON.stringify({ ...patch, id }),
      });
      if (!result.ok || result.transaction?.id !== id) throw new Error("更新未確認，請重新載入檢查。");
      if (sessionUserRef.current !== owner) return;
      setEditing(null); setMessage("✅ 交易已更新。");
      await loadCloudData().catch(() => setMessage("已更新，請重新整理交易列表。"));
    } finally { if (sessionUserRef.current === owner) setBusy(false); }
  };

  const acceptQuickDraft = (draft: QuickDraft) => {
    if (!session || dataLoading || dataError) return;
    setAmount(draft.amount); setMerchant(draft.merchant); setDirection(draft.direction);
    setAccountId(draft.accountId || ""); setCategoryId(draft.categoryId || "");
    setNote(draft.original); setOccurredAt(`${draft.day}T12:00`);
    manualRequest.current = null; setQuickDraftActive(true); setActiveTab("capture"); setMessage("");
  };

  const deleteTransaction = async (id: string) => {
    if (!session) return;
    const transaction = transactions.find((row) => row.id === id);
    if (!window.confirm(`確定刪除「${transaction?.merchant || "這筆交易"}」？刪除後無法復原。`)) return;
    setBusy(true);
    setMessage("");
    try {
      await cloudRequest("/api/v2/transactions", session, {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setMessage("交易已刪除。");
      await loadCloudData().catch(() => setMessage("交易已刪除，請重新整理列表。"));
    } catch {
      setMessage("刪除失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async () => {
    if (!session) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await cloudRequest<PairStart>("/api/v2/pair/start", session, {
        method: "POST",
        body: "{}",
      });
      if (!data.pair_ticket) throw new Error("Missing pair ticket");
      setTicket(data);
      window.location.href = shortcutUrl(data.pair_ticket);
    } catch {
      setMessage("無法建立連接票券，請重新登入後再試。");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (deviceId: string) => {
    if (!session) return;
    setBusy(true);
    setMessage("");
    try {
      await cloudRequest("/api/v2/devices", session, {
        method: "POST",
        body: JSON.stringify({ device_id: deviceId }),
      });
      await loadCloudData();
    } catch {
      setMessage("解除裝置失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  if (!CLOUD_READY) {
    return (
      <main className="ledger-site">
        <section className="ls-connect-shell ls-wrap">
          <div className="ls-connect-card">
            <p className="ls-eyebrow">Ledger Cloud · deployment gate</p>
            <h1>免費雲端版尚未接上資料庫</h1>
            <p>這個 build 不會碰私人 M4 Ledger。部署獨立 Supabase 並設定環境變數後，才會開放註冊。</p>
            <a className="ls-button ls-secondary" href="/">回產品網站</a>
          </div>
        </section>
      </main>
    );
  }

  if (authChecking) {
    return <main className="ledger-site"><section className="ls-connect-shell ls-wrap" role="status"><p>正在確認登入…</p></section></main>;
  }

  const exportTransactions = () => {
    if (dataLoading || dataError || !loadedAt) return;
    const csv = ledgerCsv(filteredTransactions, accountById, categoryById);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `liubai-ledger-${filterMonth || "all"}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`已匯出 ${filteredTransactions.length} 筆目前篩選的交易。`);
  };

  if (session) {
    const renderTransactionRows = (items: CloudTransaction[]) => (
      <div className="ls-app-transaction-list">
        {items.map((tx) => {
          const account = tx.account_id ? accountById.get(tx.account_id) : null;
          const category = tx.category_id ? categoryById.get(tx.category_id) : null;
          return (
            <article className="ls-app-transaction-row" key={tx.id}>
              <div className="ls-app-transaction-icon" data-source={tx.source}>
                {tx.source === "apple_pay" ? <WalletCards size={17} /> : <Receipt size={17} />}
              </div>
              <button type="button" className="ls-app-transaction-copy ls-transaction-open" aria-label={`編輯 ${tx.merchant || "交易"}`} title={tx.merchant || "交易"} disabled={busy} onClick={() => setEditing(tx)}>
                <strong>{tx.merchant || "未取得商家"}</strong>
                <small>
                  {transactionTimeLabel(tx)}
                  {category ? ` · ${category.name}` : ""}
                  {account ? ` · ${account.name}` : tx.card_label ? ` · ${tx.card_label}` : ""}
                </small>
              </button>
              <div className="ls-app-transaction-amount">
                <strong>{moneyLabel(tx)}</strong>
                <span data-status={tx.source === "apple_pay" && !tx.account_id ? "pending" : tx.status}>{tx.source === "apple_pay" && !tx.account_id ? "卡片待對應" : statusLabel(tx.status)}</span>
              </div>
              <button
                type="button"
                className="ls-app-transaction-delete"
                aria-label={`刪除 ${tx.merchant || "交易"}`}
                disabled={busy}
                onClick={() => void deleteTransaction(tx.id)}
              >
                <Trash2 size={15} />
              </button>
            </article>
          );
        })}
      </div>
    );

    const navItems = [
      { id: "home" as const, label: "首頁", icon: Home },
      { id: "capture" as const, label: "記一筆", icon: Plus },
      { id: "transactions" as const, label: "交易", icon: Receipt },
      { id: "explore" as const, label: "探索", icon: Search },
      { id: "settings" as const, label: "設定", icon: Settings2 },
    ];

    return (
      <main className="ledger-site ls-app-root" data-theme={resolvedTheme}>
        <section className="ls-app-shell">
          <header className="ls-app-topbar">
            <button className="ls-app-brand" type="button" onClick={() => setActiveTab("home")} aria-label="回到帳本首頁">
              <span className="ls-brand-mark">留</span>
              <span><strong>Ledger</strong><small>留白工作室</small></span>
            </button>
            <nav className="ls-app-desktop-nav" aria-label="帳本導覽">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" data-active={activeTab === id} onClick={() => setActiveTab(id)}>
                  <Icon size={16} /> {label}
                </button>
              ))}
            </nav>
            <button className="ls-app-signout" type="button" onClick={() => void supabase?.auth.signOut()}>
              <LogOut size={16} /><span>登出</span>
            </button>
          </header>

          <div className="ls-app-main">
            {editing ? <TransactionEditor key={`${session.user.id}-${editing.id}`} transaction={editing} accounts={accounts} categories={categories} onSave={saveEdit} onClose={() => { if (!busy) setEditing(null); }} /> : null}
            {dataError ? <div className="ls-load-error" role="alert"><div><strong>帳本尚未完整更新</strong><p>{dataError}{loadedAt ? " 下方保留上次成功載入的資料。" : " 這不代表帳本沒有交易。"}</p></div><button type="button" className="ls-button ls-secondary" disabled={dataLoading} onClick={() => void loadCloudData().catch(() => {})}>重試載入</button></div> : null}
            {dataLoading ? <p className="ls-load-state" role="status">正在同步帳本…</p> : null}
            {issuedRecoveryCode ? (
              <section className="ls-app-recovery-banner">
                <div><strong>請先保存復原碼</strong><span>之後忘記密碼時會用到。</span></div>
                <div className="ls-recovery-actions">
                  <button className="ls-button ls-secondary" type="button" onClick={() => void copyRecoveryCode()}><Copy size={15} /> 複製</button>
                  <button className="ls-button ls-secondary" type="button" onClick={downloadRecoveryCode}><Download size={15} /> 下載</button>
                  <button className="ls-button ls-primary" type="button" onClick={() => setIssuedRecoveryCode("")}>我已保存</button>
                </div>
              </section>
            ) : null}

            {activeTab === "home" ? (
              <div className="ls-app-page">
                <section className="ls-app-page-head">
                  <div>
                    <p>{displayName}</p>
                    <h1>我的帳本</h1>
                    <span>今天的支出、最近交易，都在這裡。</span>
                  </div>
                  <button className="ls-button ls-primary ls-app-primary-action" type="button" onClick={() => setActiveTab("capture")}>
                    <Plus size={17} /> 記一筆
                  </button>
                </section>

                <ShortcutOnboarding key={`home-${session.user.id}`} session={session} compact pairingBusy={busy} onPair={startPairing} onOpenSettings={openShortcutSettings} />
                <div className="ls-ledger-period"><label>總覽月份<select aria-label="總覽月份" value={overviewMonth} onChange={(event) => setOverviewMonth(event.target.value)}>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label><label>幣別<select aria-label="總覽幣別" value={overviewCurrency} onChange={(event) => setOverviewCurrency(event.target.value)}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><small>只計已確認交易；轉帳不列收支</small></div>
                <section className="ls-app-stat-grid" aria-label="月份總覽">
                  <article className="ls-app-stat ls-app-stat-primary">
                    <span>{overviewMonth === currentMonth() ? "本月支出" : "當月支出"}</span>
                    <strong>{loadedAt ? absoluteMoneyFromMinor(summary.expense, overviewCurrency) : "—"}</strong>
                    <small>{summary.confirmed} 筆已確認{summary.pending ? ` · ${summary.pending} 筆待確認` : ""}{summary.refund ? ` · 退款 ${absoluteMoneyFromMinor(summary.refund, overviewCurrency)}` : ""}</small>
                  </article>
                  <article className="ls-app-stat">
                    <span>{overviewMonth === currentMonth() ? "本月收入" : "當月收入"}</span>
                    <strong>{loadedAt ? absoluteMoneyFromMinor(summary.income, overviewCurrency) : "—"}</strong>
                    <small>已確認交易</small>
                  </article>
                  <article className="ls-app-stat">
                    <span>捷徑裝置</span>
                    <strong>{activeDevices.length > 0 ? "已配對" : "待配對"}</strong>
                    <small>{activeDevices.length > 0 ? `${activeDevices.length} 台 · 設定頁可測試入帳` : "先用手動捷徑測通"}</small>
                  </article>
                </section>

                <section className="ls-app-panel">
                  <div className="ls-app-panel-head">
                    <div><p>最近交易</p><h2>最新紀錄</h2></div>
                    <button type="button" onClick={() => setActiveTab("transactions")}>查看全部 <ChevronRight size={15} /></button>
                  </div>
                  {!loadedAt ? <p className="ls-load-state">{dataError ? "交易尚未載入，請重試。" : "正在載入交易…"}</p> : recentTransactions.length > 0 ? renderTransactionRows(recentTransactions) : (
                    <div className="ls-app-empty">
                      <span className="ls-app-empty-icon"><Receipt size={22} /></span>
                      <strong>還沒有交易</strong>
                      <p>先記第一筆，或連接 iPhone 開始自動記帳。</p>
                      <div>
                        <button className="ls-button ls-primary" type="button" onClick={() => setActiveTab("capture")}><Plus size={16} /> 記第一筆</button>
                        <button className="ls-button ls-secondary" type="button" onClick={openShortcutSettings}><Smartphone size={16} /> 連接 iPhone</button>
                      </div>
                    </div>
                  )}
                </section>

                <details className="ls-month-tools"><summary>預算、預留與固定支出 · {overviewMonth}</summary><MonthlyPlanner key={`budget-home-${session.user.id}-${overviewMonth}-${overviewCurrency}`} session={session} month={overviewMonth} currency={overviewCurrency} transactions={transactions} categories={categories} accounts={accounts} dataReady={Boolean(loadedAt) && !dataError && !dataLoading} /></details>
                <section className="ls-app-quick-grid">
                  <button type="button" onClick={() => setActiveTab("capture")}><span><Plus size={18} /></span><strong>快速記帳</strong><small>新增一筆支出</small></button>
                  <button type="button" onClick={() => setActiveTab("transactions")}><span><BarChart3 size={18} /></span><strong>交易紀錄</strong><small>查看全部流水</small></button>
                  <button type="button" onClick={openShortcutSettings}><span><Smartphone size={18} /></span><strong>自動記帳</strong><small>{activeDevices.length ? "裝置已連接" : "設定 iPhone"}</small></button>
                </section>
              </div>
            ) : null}

            {activeTab === "capture" ? (
              <div className="ls-app-page ls-app-page-narrow">
                <section className="ls-app-page-head">
                  <div><p>快速記帳</p><h1>記一筆</h1><span>填最少的欄位，幾秒就完成。</span></div>
                </section>
                {quickDraftActive ? <p role="status" className="lx-warning">草稿已帶入，尚未記帳。時間先預填中午 12:00，請確認付款帳戶、分類與實際時間後儲存。</p> : null}
                <section className="ls-app-panel ls-app-capture-card">
                  <div className="ls-direction-switch" role="group" aria-label="收支類型"><button type="button" aria-pressed={direction === "expense"} onClick={() => setDirection("expense")}>支出</button><button type="button" aria-pressed={direction === "income"} onClick={() => setDirection("income")}>收入</button></div>
                  <label className="ls-app-amount-field">
                    <span>金額</span>
                    <div><small>{captureCurrency === "TWD" ? "NT$" : captureCurrency}</small><input aria-label="金額" inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></div>
                  </label>
                  <div className="ls-app-form-grid">
                    <label className="ls-app-field ls-app-field-wide"><span>商家 / 項目</span><input placeholder="例如：午餐、Uber、咖啡" value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
                    <label className="ls-app-field"><span>分類</span><select aria-label="分類" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分類（可選擇）</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                    <label className="ls-app-field"><span>帳戶</span><select aria-label="帳戶" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">請選擇付款帳戶</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                    <label className="ls-app-field"><span>時間</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
                    <label className="ls-app-field ls-app-field-wide"><span>備註（選填）</span><input placeholder="可留白" value={note} onChange={(event) => setNote(event.target.value)} /></label>
                  </div>
                  <button className="ls-button ls-primary ls-app-save" type="button" disabled={busy || dataLoading || Boolean(dataError) || !loadedAt || !amount.trim() || !merchant.trim()} onClick={() => void submitManual()}>
                    <CheckCircle2 size={17} /> {busy ? "儲存中…" : "儲存交易"}
                  </button>
                </section>
              </div>
            ) : null}

            {activeTab === "transactions" ? (
              <div className="ls-app-page">
                <section className="ls-app-page-head">
                  <div><p>Ledger</p><h1>交易紀錄</h1><span>{loadedAt ? `共 ${transactions.length} 筆，符合篩選 ${filteredTransactions.length} 筆` : "正在載入帳本"}；依原始日期排列。</span></div>
                  <button className="ls-button ls-secondary" type="button" disabled={busy} onClick={() => void loadCloudData().catch(() => setMessage("重新整理失敗，請稍後再試。"))}>
                    <RefreshCw size={16} /> 重新整理
                  </button>
                </section>
                {loadedAt && !dataError ? <details className="ls-month-tools"><summary>分析與預算 · {filterMonth || overviewMonth} · {overviewCurrency}</summary><p>依目前月份與幣別計算完整帳本；下方商家、帳戶篩選只影響明細。</p><SpendingInsights transactions={transactions} month={filterMonth || overviewMonth} currency={overviewCurrency} categories={categories} accounts={accounts} onFilterCategory={(id)=>{setSelectedCategory(id || "__uncategorized__");setSelectedAccount("");setSelectedStatus("confirmed");setSearch("");setFilterMonth(filterMonth || overviewMonth);setVisibleCount(100);}} /><MonthlyPlanner key={`budget-tx-${session.user.id}-${filterMonth || overviewMonth}-${overviewCurrency}`} session={session} month={filterMonth || overviewMonth} currency={overviewCurrency} transactions={transactions} categories={categories} accounts={accounts} dataReady={Boolean(loadedAt) && !dataError && !dataLoading} /></details> : null}
                <div className="ls-transaction-toolbar"><label>搜尋<input aria-label="搜尋交易" type="search" placeholder="商家、卡片、分類、備註" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(100); }} /></label><label>月份<select aria-label="交易月份" value={filterMonth} onChange={(event) => { setFilterMonth(event.target.value); if (event.target.value) setOverviewMonth(event.target.value); setVisibleCount(100); }}><option value="">全部月份</option>{months.map((month) => <option key={month} value={month}>{month}</option>)}</select></label><button className="ls-button ls-secondary" type="button" disabled={!loadedAt || dataLoading || Boolean(dataError) || !filteredTransactions.length} onClick={exportTransactions}><Download size={16} /> 匯出 CSV</button></div>
                <div className="ls-transaction-toolbar"><label>帳戶<select aria-label="篩選帳戶" value={selectedAccount} onChange={(e) => {setSelectedAccount(e.target.value);setVisibleCount(100);}}><option value="">全部帳戶</option>{accounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>分類<select aria-label="篩選分類" value={selectedCategory} onChange={(e) => {setSelectedCategory(e.target.value);setVisibleCount(100);}}><option value="">全部分類</option><option value="__uncategorized__">未分類</option>{categories.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>狀態<select aria-label="篩選狀態" value={selectedStatus} onChange={(e) => {setSelectedStatus(e.target.value);setVisibleCount(100);}}><option value="">全部狀態</option><option value="confirmed">已確認</option><option value="pending">待確認</option><option value="duplicate">重複</option></select></label></div>
                <section className="ls-app-panel">
                  {!loadedAt ? <p className="ls-load-state">{dataError ? "尚未載入，請按重試；不是空白帳本。" : "正在載入交易…"}</p> : filteredTransactions.length > 0 ? <>{renderTransactionRows(filteredTransactions.slice(0, visibleCount))}{filteredTransactions.length > visibleCount ? <button className="ls-button ls-secondary ls-load-more" onClick={() => setVisibleCount((count) => count + 100)}>顯示更多（尚有 {filteredTransactions.length - visibleCount} 筆）</button> : null}</> : (
                    <div className="ls-app-empty"><span className="ls-app-empty-icon"><Receipt size={22} /></span><strong>{transactions.length ? "沒有符合的交易" : "還沒有交易"}</strong><p>{transactions.length ? "試試其他月份或搜尋文字。" : "新增第一筆後，交易會出現在這裡。"}</p><button className="ls-button ls-primary" type="button" onClick={() => setActiveTab("capture")}><Plus size={16} /> 記一筆</button></div>
                  )}
                </section>
              </div>
            ) : null}

            {activeTab === "explore" ? <LedgerExplore key={`explore-${session.user.id}`} rows={transactions} accounts={accounts} categories={categories} months={months} currencies={currencies} initialMonth={overviewMonth} initialCurrency={overviewCurrency} ready={Boolean(loadedAt)} error={dataError} loading={dataLoading} onRefresh={() => void loadCloudData().catch(() => {})} onDraft={acceptQuickDraft} onTransaction={(id) => { const row = transactions.find((item) => item.id === id); if (row) setEditing(row); }} /> : null}

            {activeTab === "settings" ? (
              <div className="ls-app-page">
                <section className="ls-app-page-head">
                  <div><p>設定</p><h1>帳號與設定</h1><span>管理帳號、安全、偏好與 iPhone 捷徑。</span></div>
                </section>
                <div className="ls-direction-switch" role="group" aria-label="設定分類"><button type="button" aria-pressed={settingsSection === "general"} onClick={() => setSettingsSection("general")}>一般設定</button><button type="button" aria-pressed={settingsSection === "shortcuts"} onClick={() => setSettingsSection("shortcuts")}>iPhone 自動記帳</button></div>
                {settingsSection === "general" ? <AccountSettings key={session.user.id} session={session} client={supabase!} preferences={preferences} accounts={accounts} categories={categories} ready={Boolean(loadedAt) && !dataError} onPreferencesChanged={preferencesChanged} onSignOut={() => void supabase?.auth.signOut({ scope: "local" })} /> : <>
                <details className="ls-beta-help"><summary>公開測試版：開始使用與支援</summary><p>登入後即可在「記一筆」新增支出或收入；「交易」可搜尋、切換月份，並匯出目前篩選的 CSV。每個人的付款方式與交易獨立保存。</p><p>免費 Beta 目前最多 500 個帳號，每帳號 5 台啟用裝置。銀行自動同步不在目前承諾範圍；請保留重要交易的原始收據與帳單。</p><p>iPhone 捷徑屬進階 Beta。首次需在自己的手機安裝、授權與配對；配對成功不代表 Apple Pay 真機觸發已驗收。網站／App 付款不保證觸發，可用手動記帳補記。</p><div className="ls-beta-links"><a href="mailto:asdapper8866@gmail.com?subject=Ledger%20Beta%20Support">回報問題／申請帳號刪除</a><a href="/privacy">隱私權</a><a href="/terms">服務條款</a></div></details>
                <ShortcutOnboarding key={`setup-${session.user.id}`} session={session} pairingBusy={busy} onPair={startPairing} onOpenSettings={openShortcutSettings} />
                <PaymentSettings session={session} onChanged={loadCloudData} />

                <section className="ls-app-panel">
                  <div className="ls-app-panel-head"><div><p>Devices</p><h2>已連接裝置</h2></div>{paired && activeDevices.length > 0 ? <span className="ls-success-pill"><CheckCircle2 size={15} /> 已連接裝置</span> : null}</div>
                  {activeDevices.length === 0 ? <div className="ls-app-empty ls-app-empty-compact"><strong>目前沒有已啟用裝置</strong><p>手動記帳仍可正常使用。</p></div> : (
                    <div className="ls-device-list">{activeDevices.map((device) => <div className="ls-device-row" key={device.id}><div><strong>{device.name}</strong><small>上次活動：{timeLabel(device.last_seen_at)}</small></div><button className="ls-button ls-danger-ghost" disabled={busy} onClick={() => void revoke(device.id)}><Unplug size={15} /> 解除</button></div>)}</div>
                  )}
                </section>

                <section className="ls-app-account-card">
                  <div><strong>裝置權限</strong><p>裝置只可寫入交易和讀取自己的付款選項，不能讀帳本明細。</p></div>
                </section>
                </>}
              </div>
            ) : null}
          </div>

          {message ? <p className="ls-app-toast" role="status">{message}</p> : null}

          <nav className="ls-app-bottom-nav" aria-label="手機帳本導覽">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" data-active={activeTab === id} onClick={() => setActiveTab(id)}>
                <Icon size={19} /><span>{label}</span>
              </button>
            ))}
          </nav>
        </section>
      </main>
    );
  }

  return (
    <main className="ledger-site">
      {googleSigningIn ? (
        <div className="ls-google-transition" role="status" aria-live="polite">
          <div className="ls-google-transition-card"><span className="ls-google-spinner" /><strong>正在登入 Ledger…</strong><small>Google 已完成驗證，正在載入你的帳本。</small></div>
        </div>
      ) : null}
      <section className="ls-connect-shell ls-wrap">
        <header className="ls-connect-header">
          <a className="ls-brand" href="/" aria-label="留白 Ledger 首頁">
            <span className="ls-brand-mark">留</span><span>Ledger</span>
          </a>
          {session ? (
            <button className="ls-button ls-secondary" onClick={() => void supabase?.auth.signOut()}>
              <LogOut size={16} /> 登出
            </button>
          ) : null}
        </header>

        {!session ? (
          <div className="ls-auth-stage">
            <div className="ls-auth-showcase" aria-hidden="true">
              <div className="ls-auth-showcase-copy">
                <span className="ls-auth-kicker">留白 Ledger · Free Beta</span>
                <h1>Apple Pay 刷卡，讓捷徑幫你記帳。</h1>
                <p>先用手動捷徑成功記一筆，再依引導設定 Apple Pay 自動記帳。每個人都能使用自己的信用卡與帳本。</p>
              </div>
              <div className="ls-auth-mini-app">
                <div className="ls-auth-mini-top"><span>今天</span><span>•••</span></div>
                <strong>NT$ 1,428</strong>
                <small>今日支出</small>
                <div className="ls-auth-mini-row"><span>午餐</span><b>NT$ 180</b></div>
                <div className="ls-auth-mini-row"><span>交通</span><b>NT$ 65</b></div>
                <div className="ls-auth-mini-row"><span>生活</span><b>NT$ 1,183</b></div>
              </div>
              <div className="ls-auth-proof">
                <span><ShieldCheck size={15} /> RLS 私人資料隔離</span>
                <span><Smartphone size={15} /> iPhone Wallet 可配對</span>
              </div>
            </div>

            <div className="ls-auth-card">
              <div className="ls-auth-card-brand">
                <span className="ls-auth-app-icon">留</span>
                <div>
                  <strong>Ledger</strong>
                  <small>捷徑 × Apple Pay 記帳</small>
                </div>
              </div>
              <div className="ls-auth-title">
                <h2>{authMode === "signup" ? "建立你的帳本" : authMode === "recover" ? "找回你的帳號" : "歡迎回來"}</h2>
                <p>{authMode === "signup" ? "免費開始，不需要綁信用卡。" : authMode === "recover" ? "使用你的復原碼設定新密碼。" : "先用手動捷徑成功記一筆，再設定 Apple Pay 自動記帳。"}</p>
              </div>

              {googleEnabled ? (
                <div className="ls-google-button-shell" data-ready={googleReady} aria-busy={!googleReady || busy}>
                  {!googleReady ? <span className="ls-google-placeholder">載入 Google 登入…</span> : null}
                  <div ref={googleButtonRef} className="ls-google-render" aria-label="使用 Google 繼續" />
                </div>
              ) : (
                <button className="ls-google-button" type="button" disabled title="Google OAuth Client 尚未建立">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.23-.2-1.78H12v3.43h5.52a4.77 4.77 0 0 1-2.05 3.04l-.03.11 2.98 2.31.21.02c1.93-1.78 3.04-4.4 3.04-7.13Z"/>
                    <path fill="#34A853" d="M12 22c2.7 0 4.97-.89 6.63-2.43l-3.16-2.44c-.85.58-1.98.98-3.47.98-2.61 0-4.82-1.76-5.61-4.2l-.11.01-3.1 2.4-.04.1A10 10 0 0 0 12 22Z"/>
                    <path fill="#FBBC05" d="M6.39 13.91A6.04 6.04 0 0 1 6.06 12c0-.66.12-1.3.32-1.91l-.01-.13-3.14-2.44-.1.05A10 10 0 0 0 2 12c0 1.6.38 3.12 1.14 4.43l3.25-2.52Z"/>
                    <path fill="#EA4335" d="M12 5.89c1.88 0 3.15.81 3.88 1.49l2.81-2.75C16.96 3.02 14.7 2 12 2a10 10 0 0 0-8.86 5.57l3.24 2.52C7.18 7.65 9.39 5.89 12 5.89Z"/>
                  </svg>
                  Google 登入設定中
                </button>
              )}

              <div className="ls-auth-divider"><span>或使用帳號密碼</span></div>

              <div className="ls-auth-tabs" role="tablist" aria-label="登入方式">
                <button type="button" data-active={authMode === "login"} onClick={() => setAuthMode("login")}>登入</button>
                <button type="button" data-active={authMode === "signup"} onClick={() => setAuthMode("signup")}>註冊</button>
              </div>

              <div className="ls-auth-form">
                <label className="ls-auth-field">
                  <span>帳號</span>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    placeholder="例如 rain2026"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    aria-label="帳號名稱"
                    minLength={3}
                    maxLength={24}
                  />
                </label>
                {authMode === "recover" ? (
                  <>
                    <label className="ls-auth-field">
                      <span>復原碼</span>
                      <input type="text" autoComplete="off" placeholder="LBR- 開頭的復原碼" value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} aria-label="復原碼" />
                    </label>
                    <label className="ls-auth-field">
                      <span>新密碼</span>
                      <input type="password" autoComplete="new-password" placeholder="至少 12 個字元" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-label="新密碼" minLength={12} maxLength={128} />
                    </label>
                  </>
                ) : (
                  <label className="ls-auth-field">
                    <span>密碼</span>
                    <input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} placeholder="至少 12 個字元" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="密碼" minLength={12} maxLength={128} />
                  </label>
                )}
                <button className="ls-button ls-primary ls-auth-submit" disabled={busy || !username.trim() || (authMode === "recover" ? !recoveryCode.trim() || newPassword.length < 12 : password.length < 12)} onClick={() => void authenticate()}>
                  {busy ? "處理中…" : authMode === "signup" ? "建立免費帳號" : authMode === "recover" ? "重設密碼" : "登入"}
                </button>
              </div>

              {authMode !== "signup" ? (
                <button className="ls-auth-link" type="button" onClick={() => setAuthMode(authMode === "recover" ? "login" : "recover")}>
                  {authMode === "recover" ? "回到登入" : "忘記密碼？"}
                </button>
              ) : (
                <p className="ls-auth-note">註冊後會產生一次性復原碼，請下載或離線保存。</p>
              )}

              {issuedRecoveryCode && !session ? (
                <div className="ls-recovery-box">
                  <strong>新的復原碼</strong>
                  <code>{issuedRecoveryCode}</code>
                  <div className="ls-recovery-actions">
                    <button className="ls-button ls-secondary" type="button" onClick={() => void copyRecoveryCode()}><Copy size={15} /> 複製</button>
                    <button className="ls-button ls-secondary" type="button" onClick={downloadRecoveryCode}><Download size={15} /> 下載</button>
                  </div>
                </div>
              ) : null}

              <div className="ls-auth-trust"><KeyRound size={14} /> 密碼由 Supabase Auth 處理，Ledger 不保存明文密碼</div>
              <div className="ls-auth-legal"><a href="/privacy">隱私權政策</a><span>·</span><a href="/terms">服務條款</a></div>
            </div>
          </div>
        ) : (
          <>
            <div className="ls-connect-card ls-connect-hero">
              <span className="ls-connect-icon"><Cloud size={24} /></span>
              <p className="ls-eyebrow">Free beta · multi-tenant</p>
              <h1>你的帳本，不需要一台電腦永遠開著。</h1>
              <p className="ls-connect-lead">免費建立自己的雲端 Ledger。手動記帳立即可用；iPhone 配對後，再把支援的 Wallet 交易自動送進同一個帳本。</p>
              <div className="ls-connect-trust">
                <span><ShieldCheck size={16} /> 每位使用者資料由 RLS 隔離</span>
                <span><Smartphone size={16} /> 裝置憑證可獨立撤銷</span>
                <span><CheckCircle2 size={16} /> 免費方案不要求銀行帳密</span>
              </div>
            </div>
            {issuedRecoveryCode ? (
              <div className="ls-connect-card ls-recovery-card">
                <span className="ls-step-chip">重要</span>
                <h2>先保存你的復原碼</h2>
                <p>這是目前唯一能在忘記密碼時復原帳號的憑證。只顯示在這個瀏覽器工作階段，不會寄 Email。</p>
                <div className="ls-recovery-box">
                  <code>{issuedRecoveryCode}</code>
                  <div className="ls-recovery-actions">
                    <button className="ls-button ls-secondary" type="button" onClick={() => void copyRecoveryCode()}><Copy size={15} /> 複製</button>
                    <button className="ls-button ls-secondary" type="button" onClick={downloadRecoveryCode}><Download size={15} /> 下載</button>
                    <button className="ls-button ls-primary" type="button" onClick={() => setIssuedRecoveryCode("")}>我已保存</button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="ls-connect-card">
              <div className="ls-connect-card-head">
                <div>
                  <p className="ls-eyebrow">Quick capture</p>
                  <h2>先記一筆，確認你的私人帳本已建立</h2>
                </div>
                <span className="ls-success-pill"><CheckCircle2 size={15} /> Free</span>
              </div>
              <div className="ls-manual-grid">
                <label>
                  <span>金額</span>
                  <input
                    inputMode="decimal"
                    placeholder="120"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </label>
                <label className="ls-manual-wide">
                  <span>商家 / 項目</span>
                  <input
                    placeholder="例如：午餐"
                    value={merchant}
                    onChange={(event) => setMerchant(event.target.value)}
                  />
                </label>
                <label>
                  <span>帳戶</span>
                  <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>分類</span>
                  <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>時間</span>
                  <input
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(event) => setOccurredAt(event.target.value)}
                  />
                </label>
                <label className="ls-manual-wide">
                  <span>備註（選填）</span>
                  <input
                    placeholder="不需要可留白"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </div>
              <button
                className="ls-button ls-primary"
                type="button"
                disabled={busy || !amount.trim() || !merchant.trim()}
                onClick={() => void submitManual()}
              >
                <Plus size={16} /> 加入帳本
              </button>
            </div>

            <div className="ls-connect-grid">
              <div className="ls-connect-card">
                <span className="ls-step-chip">02</span>
                <h2>安裝留白自動記帳</h2>
                <p>同一份公開捷徑，不內建你的帳號、API Token 或作者私人網址。</p>
                <a className="ls-button ls-secondary" href="/shortcuts/Liubai-Cloud.shortcut" download>
                  <CreditCard size={16} /> 安裝捷徑
                </a>
              </div>
              <div className="ls-connect-card">
                <span className="ls-step-chip">03</span>
                <h2>連接這支 iPhone</h2>
                <p>建立 10 分鐘、只能使用一次的票券。裝置只取得「寫入交易」權限，不能讀取帳本。</p>
                <button className="ls-button ls-primary" disabled={busy} onClick={() => void startPairing()}>
                  <Link2 size={17} /> 連接這支 iPhone
                </button>
                {ticket ? <small>票券到期：{timeLabel(ticket.expires_at)}</small> : null}
              </div>
            </div>

            <div className="ls-connect-card">
              <span className="ls-step-chip">04</span>
              <h2>選擇要自動記帳的 Wallet 卡片</h2>
              <p>捷徑 App → 自動化 → 交易 → 選卡片 → 立即執行。Apple 對 Transaction trigger 的支援範圍以裝置實測為準；網站/App 內付款不宣稱一定觸發。</p>
            </div>

            <div className="ls-connect-card">
              <div className="ls-connect-card-head">
                <div>
                  <p className="ls-eyebrow">Devices</p>
                  <h2>已連接裝置</h2>
                </div>
                {paired ? <span className="ls-success-pill"><CheckCircle2 size={15} /> 配對完成</span> : null}
              </div>
              {devices.filter((device) => !device.revoked_at).length === 0 ? (
                <p className="ls-connect-muted">目前沒有已啟用的裝置。手動記帳仍可正常使用。</p>
              ) : (
                <div className="ls-device-list">
                  {devices.filter((device) => !device.revoked_at).map((device) => (
                    <div className="ls-device-row" key={device.id}>
                      <div><strong>{device.name}</strong><small>上次活動：{timeLabel(device.last_seen_at)}</small></div>
                      <button className="ls-button ls-danger-ghost" disabled={busy} onClick={() => void revoke(device.id)}>
                        <Unplug size={15} /> 解除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ls-connect-card">
              <div className="ls-connect-card-head">
                <div>
                  <p className="ls-eyebrow">Ledger</p>
                  <h2>最近交易</h2>
                </div>
                <button
                  className="ls-button ls-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void loadCloudData().catch(() => setMessage("重新整理失敗，請稍後再試。"))}
                >
                  重新整理
                </button>
              </div>
              {transactions.length === 0 ? (
                <p className="ls-connect-muted">還沒有交易。上面手動記一筆即可驗證 SaaS 帳本。</p>
              ) : (
                <div className="ls-cloud-tx-list">
                  {transactions.map((tx) => {
                    const account = tx.account_id ? accountById.get(tx.account_id) : null;
                    const category = tx.category_id ? categoryById.get(tx.category_id) : null;
                    return (
                      <article className="ls-cloud-tx-row" key={tx.id}>
                        <div className="ls-cloud-tx-main">
                          <strong>{tx.merchant || "未取得商家"}</strong>
                          <small>
                            {transactionTimeLabel(tx)} · {sourceLabel(tx.source)}
                            {category ? ` · ${category.name}` : ""}
                            {account ? ` · ${account.name}` : tx.card_label ? ` · ${tx.card_label}` : ""}
                          </small>
                          {tx.note ? <small>{tx.note}</small> : null}
                        </div>
                        <div className="ls-cloud-tx-meta">
                          <strong>{moneyLabel(tx)}</strong>
                          <span data-status={tx.status}>{statusLabel(tx.status)}</span>
                          <button
                            type="button"
                            className="ls-icon-button"
                            aria-label={`刪除 ${tx.merchant || "交易"}`}
                            disabled={busy}
                            onClick={() => void deleteTransaction(tx.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {message ? <p className="ls-connect-message" role="status">{message}</p> : null}
        <p className="ls-connect-footnote">
          你的帳本只屬於自己的帳號。登入後即可手動記帳，iPhone 捷徑可稍後設定。
        </p>
      </section>
    </main>
  );
}

export default CloudConnect;
