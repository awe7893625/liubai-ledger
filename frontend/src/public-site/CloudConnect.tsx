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
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./site.css";
import { PaymentSettings } from "./PaymentSettings";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? "";
const CLOUD_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);
const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)?.trim() ?? "";
const SHORTCUT_NAME = "留白自動記帳";

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

async function publicRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
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
  const response = await fetch(path, {
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
  const [activeTab, setActiveTab] = useState<"home" | "capture" | "transactions" | "settings">(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "settings" || params.get("paired") === "1" ? "settings" : "home";
  });
  const [ticket, setTicket] = useState<PairStart | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [transactions, setTransactions] = useState<CloudTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [occurredAt, setOccurredAt] = useState(dateTimeLocalValue);
  const [note, setNote] = useState("");
  const paired = useMemo(() => new URLSearchParams(window.location.search).get("paired") === "1", []);

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const activeDevices = useMemo(() => devices.filter((device) => !device.revoked_at), [devices]);
  const monthTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter((tx) => {
      const when = tx.legacy_date
        ? tx.legacy_date.slice(0, 7)
        : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(new Date(tx.occurred_at));
      const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).format(now);
      return when === current;
    });
  }, [transactions]);
  const monthExpense = useMemo(
    () => monthTransactions.reduce((sum, tx) => {
      if (tx.legacy_kind === "transfer") return sum;
      if (tx.legacy_kind === "refund") return sum + (tx.amount_minor ?? 0);
      return sum + Math.min(tx.amount_minor ?? 0, 0);
    }, 0),
    [monthTransactions],
  );
  const monthIncome = useMemo(
    () => monthTransactions.reduce((sum, tx) => {
      if (tx.legacy_kind === "transfer" || tx.legacy_kind === "refund") return sum;
      return sum + Math.max(tx.amount_minor ?? 0, 0);
    }, 0),
    [monthTransactions],
  );
  const recentTransactions = useMemo(() => transactions.slice(0, 5), [transactions]);
  const displayName = useMemo(() => {
    const raw = session?.user.user_metadata?.display_name;
    return typeof raw === "string" && raw.trim() ? raw.trim() : "我的帳本";
  }, [session]);

  const loadCloudData = useCallback(async () => {
    if (!supabase || !session) return;
    const bootstrap = await cloudRequest<BootstrapResponse>("/api/v2/bootstrap", session, {
      method: "POST",
      body: "{}",
    });
    setAccounts(bootstrap.accounts ?? []);
    setCategories(bootstrap.categories ?? []);
    setAccountId((current) => current || bootstrap.accounts?.[0]?.id || "");
    setCategoryId((current) => current || bootstrap.categories?.find((item) => item.slug === "other")?.id || bootstrap.categories?.[0]?.id || "");

    const [deviceResult, transactionResult] = await Promise.all([
      cloudRequest<{ ok: boolean; devices: Device[] }>("/api/v2/devices", session),
      supabase
        .from("ledger_transactions")
        .select("id,request_id,source,amount_minor,currency,merchant,card_label,status,occurred_at,account_id,category_id,note,legacy_date,legacy_kind,legacy_description")
        .order("occurred_at", { ascending: false })
        .limit(1000),
    ]);
    let availableTransactions: CloudTransaction[] = (transactionResult.data ?? []) as unknown as CloudTransaction[];
    if (transactionResult.error) {
      // Keep the public app usable during rolling schema deployments.
      const oldSchema = await supabase
        .from("ledger_transactions")
        .select("id,request_id,source,amount_minor,currency,merchant,card_label,status,occurred_at,account_id,category_id,note")
        .order("occurred_at", { ascending: false })
        .limit(1000);
      if (oldSchema.error) throw oldSchema.error;
      availableTransactions = (oldSchema.data ?? []) as unknown as CloudTransaction[];
    }
    setDevices(deviceResult.devices ?? []);
    setTransactions(availableTransactions);
  }, [session]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
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
    void loadCloudData().catch(() => setMessage("目前無法讀取雲端帳本資料。"));
  }, [session, loadCloudData]);

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
    if (!session || !amount.trim() || !merchant.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const parsedDate = new Date(occurredAt);
      await cloudRequest("/api/v2/transactions", session, {
        method: "POST",
        body: JSON.stringify({
          amount,
          merchant,
          account_id: accountId || null,
          category_id: categoryId || null,
          occurred_at: Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate.toISOString(),
          note,
          direction: "expense",
          currency: "TWD",
        }),
      });
      setAmount("");
      setMerchant("");
      setNote("");
      setOccurredAt(dateTimeLocalValue());
      setMessage("✅ 已記帳。");
      await loadCloudData();
      setActiveTab("home");
    } catch (error) {
      setMessage(error instanceof Error ? `記帳失敗：${error.message}` : "記帳失敗，請稍後重試。");
    } finally {
      setBusy(false);
    }
  };

  const deleteTransaction = async (id: string) => {
    if (!session) return;
    setBusy(true);
    setMessage("");
    try {
      await cloudRequest("/api/v2/transactions", session, {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      setMessage("交易已刪除。");
      await loadCloudData();
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
              <div className="ls-app-transaction-copy">
                <strong>{tx.merchant || "未取得商家"}</strong>
                <small>
                  {transactionTimeLabel(tx)}
                  {category ? ` · ${category.name}` : ""}
                  {account ? ` · ${account.name}` : tx.card_label ? ` · ${tx.card_label}` : ""}
                </small>
              </div>
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
      { id: "settings" as const, label: "設定", icon: Settings2 },
    ];

    return (
      <main className="ledger-site ls-app-root">
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

                <section className="ls-app-stat-grid" aria-label="本月總覽">
                  <article className="ls-app-stat ls-app-stat-primary">
                    <span>本月支出</span>
                    <strong>{absoluteMoneyFromMinor(monthExpense)}</strong>
                    <small>{monthTransactions.length} 筆交易</small>
                  </article>
                  <article className="ls-app-stat">
                    <span>本月收入</span>
                    <strong>{absoluteMoneyFromMinor(monthIncome)}</strong>
                    <small>已確認交易</small>
                  </article>
                  <article className="ls-app-stat">
                    <span>自動記帳</span>
                    <strong>{activeDevices.length > 0 ? "已連接" : "未連接"}</strong>
                    <small>{activeDevices.length > 0 ? `${activeDevices.length} 台裝置` : "可稍後設定"}</small>
                  </article>
                </section>

                <section className="ls-app-panel">
                  <div className="ls-app-panel-head">
                    <div><p>最近交易</p><h2>最新紀錄</h2></div>
                    <button type="button" onClick={() => setActiveTab("transactions")}>查看全部 <ChevronRight size={15} /></button>
                  </div>
                  {recentTransactions.length > 0 ? renderTransactionRows(recentTransactions) : (
                    <div className="ls-app-empty">
                      <span className="ls-app-empty-icon"><Receipt size={22} /></span>
                      <strong>還沒有交易</strong>
                      <p>先記第一筆，或連接 iPhone 開始自動記帳。</p>
                      <div>
                        <button className="ls-button ls-primary" type="button" onClick={() => setActiveTab("capture")}><Plus size={16} /> 記第一筆</button>
                        <button className="ls-button ls-secondary" type="button" onClick={() => setActiveTab("settings")}><Smartphone size={16} /> 連接 iPhone</button>
                      </div>
                    </div>
                  )}
                </section>

                <section className="ls-app-quick-grid">
                  <button type="button" onClick={() => setActiveTab("capture")}><span><Plus size={18} /></span><strong>快速記帳</strong><small>新增一筆支出</small></button>
                  <button type="button" onClick={() => setActiveTab("transactions")}><span><BarChart3 size={18} /></span><strong>交易紀錄</strong><small>查看全部流水</small></button>
                  <button type="button" onClick={() => setActiveTab("settings")}><span><Smartphone size={18} /></span><strong>自動記帳</strong><small>{activeDevices.length ? "裝置已連接" : "設定 iPhone"}</small></button>
                </section>
              </div>
            ) : null}

            {activeTab === "capture" ? (
              <div className="ls-app-page ls-app-page-narrow">
                <section className="ls-app-page-head">
                  <div><p>快速記帳</p><h1>記一筆</h1><span>填最少的欄位，幾秒就完成。</span></div>
                </section>
                <section className="ls-app-panel ls-app-capture-card">
                  <label className="ls-app-amount-field">
                    <span>金額</span>
                    <div><small>NT$</small><input inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus /></div>
                  </label>
                  <div className="ls-app-form-grid">
                    <label className="ls-app-field ls-app-field-wide"><span>商家 / 項目</span><input placeholder="例如：午餐、Uber、咖啡" value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
                    <label className="ls-app-field"><span>分類</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
                    <label className="ls-app-field"><span>帳戶</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
                    <label className="ls-app-field"><span>時間</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
                    <label className="ls-app-field ls-app-field-wide"><span>備註（選填）</span><input placeholder="可留白" value={note} onChange={(event) => setNote(event.target.value)} /></label>
                  </div>
                  <button className="ls-button ls-primary ls-app-save" type="button" disabled={busy || !amount.trim() || !merchant.trim()} onClick={() => void submitManual()}>
                    <CheckCircle2 size={17} /> {busy ? "儲存中…" : "儲存交易"}
                  </button>
                </section>
              </div>
            ) : null}

            {activeTab === "transactions" ? (
              <div className="ls-app-page">
                <section className="ls-app-page-head">
                  <div><p>Ledger</p><h1>交易紀錄</h1><span>已載入 {transactions.length} 筆；歷史交易依原始日期排列。</span></div>
                  <button className="ls-button ls-secondary" type="button" disabled={busy} onClick={() => void loadCloudData().catch(() => setMessage("重新整理失敗，請稍後再試。"))}>
                    <RefreshCw size={16} /> 重新整理
                  </button>
                </section>
                <section className="ls-app-panel">
                  {transactions.length > 0 ? renderTransactionRows(transactions) : (
                    <div className="ls-app-empty"><span className="ls-app-empty-icon"><Receipt size={22} /></span><strong>還沒有交易</strong><p>新增第一筆後，交易會出現在這裡。</p><button className="ls-button ls-primary" type="button" onClick={() => setActiveTab("capture")}><Plus size={16} /> 記第一筆</button></div>
                  )}
                </section>
              </div>
            ) : null}

            {activeTab === "settings" ? (
              <div className="ls-app-page">
                <section className="ls-app-page-head">
                  <div><p>設定</p><h1>付款方式與 iPhone</h1><span>先設定自己的卡片，再安裝捷徑；平常直接記帳就好。</span></div>
                </section>
                <PaymentSettings session={session} onChanged={loadCloudData} />
                <section className="ls-app-settings-grid">
                  <article className="ls-app-setting-card">
                    <span className="ls-app-setting-icon"><CreditCard size={19} /></span>
                    <div><strong>1. 安裝自動記帳捷徑</strong><p>新版 v2：所有卡片共用、確認入帳才通知，不需填網址或 Token。舊版請選取代，保留名稱「留白自動記帳」。</p></div>
                    <a className="ls-button ls-secondary" href="/shortcuts/Liubai-Cloud.shortcut" download>安裝自動記帳</a>
                  </article>
                  <article className="ls-app-setting-card">
                    <span className="ls-app-setting-icon"><Plus size={19} /></span>
                    <div><strong>2. 安裝手動記帳捷徑</strong><p>支出／收入、選自己的付款方式與分類、備註、未確認資料重送。沿用同一次配對。</p></div>
                    <a className="ls-button ls-secondary" href="/shortcuts/Liubai-Manual.shortcut" download>安裝手動記帳</a>
                  </article>
                  <article className="ls-app-setting-card">
                    <span className="ls-app-setting-icon"><Link2 size={19} /></span>
                    <div><strong>3. 連接這支 iPhone</strong><p>先安裝自動記帳捷徑，再按連接。票券 10 分鐘有效；兩支捷徑共用裝置憑證。</p></div>
                    <button className="ls-button ls-primary" disabled={busy} onClick={() => void startPairing()}>連接 iPhone</button>
                    {ticket ? <small>票券到期：{timeLabel(ticket.expires_at)}</small> : null}
                  </article>
                  <article className="ls-app-setting-card">
                    <span className="ls-app-setting-icon"><WalletCards size={19} /></span>
                    <div><strong>4. 測試與 Wallet 自動化</strong><p>先開手動捷徑選「測試連線」，不會建立交易。再到自動化 → 交易 → 選卡片 → 立即執行。</p><p>傳入辭典：amount＝交易金額、merchant＝商家、card＝卡片名稱，再執行「留白自動記帳」。網站付款不保證觸發，可用手動捷徑補記。</p></div>
                  </article>
                </section>

                <section className="ls-app-panel">
                  <div className="ls-app-panel-head"><div><p>Devices</p><h2>已連接裝置</h2></div>{paired && activeDevices.length > 0 ? <span className="ls-success-pill"><CheckCircle2 size={15} /> 已連接裝置</span> : null}</div>
                  {activeDevices.length === 0 ? <div className="ls-app-empty ls-app-empty-compact"><strong>目前沒有已啟用裝置</strong><p>手動記帳仍可正常使用。</p></div> : (
                    <div className="ls-device-list">{activeDevices.map((device) => <div className="ls-device-row" key={device.id}><div><strong>{device.name}</strong><small>上次活動：{timeLabel(device.last_seen_at)}</small></div><button className="ls-button ls-danger-ghost" disabled={busy} onClick={() => void revoke(device.id)}><Unplug size={15} /> 解除</button></div>)}</div>
                  )}
                </section>

                <section className="ls-app-account-card">
                  <div><strong>帳號與安全</strong><p>裝置只可寫入交易與讀取自己的付款選項，不能讀帳本明細。憑證保存在 iCloud「捷徑」檔案夾，不要分享。</p></div>
                  <button className="ls-button ls-secondary" type="button" onClick={() => void supabase?.auth.signOut()}><LogOut size={16} /> 登出</button>
                </section>
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
                <h1>記帳，應該像打開一個 App 一樣簡單。</h1>
                <p>登入後就能使用你的私人雲端帳本，之後再把 iPhone Wallet 自動記帳接進來。</p>
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
                  <small>你的私人記帳 App</small>
                </div>
              </div>
              <div className="ls-auth-title">
                <h2>{authMode === "signup" ? "建立你的帳本" : authMode === "recover" ? "找回你的帳號" : "歡迎回來"}</h2>
                <p>{authMode === "signup" ? "免費開始，不需要綁信用卡。" : authMode === "recover" ? "使用你的復原碼設定新密碼。" : "登入後繼續使用你的 Ledger。"}</p>
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
