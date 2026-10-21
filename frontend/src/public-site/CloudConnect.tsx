import { createClient, type Session } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Cloud,
  CreditCard,
  Link2,
  LogOut,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./site.css";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() ?? "";
const CLOUD_READY = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SHORTCUT_NAME = "留白自動記帳";

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
  source: "apple_pay" | "manual" | "notification" | "statement";
  amount_minor: number | null;
  currency: string;
  merchant: string | null;
  card_label: string | null;
  status: "pending" | "confirmed" | "duplicate" | "error";
  occurred_at: string;
  account_id: string | null;
  category_id: string | null;
  note: string | null;
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

function moneyLabel(tx: CloudTransaction): string {
  if (tx.amount_minor === null) return "待補金額";
  const amount = tx.amount_minor / 100;
  const sign = amount < 0 ? "−" : amount > 0 ? "+" : "";
  const absolute = Math.abs(amount).toLocaleString("zh-TW", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return tx.currency === "TWD" ? `${sign}NT$${absolute}` : `${sign}${tx.currency} ${absolute}`;
}

function statusLabel(status: CloudTransaction["status"]): string {
  return status === "confirmed" ? "已記帳" : status === "pending" ? "待確認" : status === "duplicate" ? "重複" : "需處理";
}

function sourceLabel(source: CloudTransaction["source"]): string {
  if (source === "apple_pay") return "Apple Pay";
  if (source === "manual") return "手動";
  if (source === "notification") return "通知";
  return "對帳";
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
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
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
        .select("id,request_id,source,amount_minor,currency,merchant,card_label,status,occurred_at,account_id,category_id,note")
        .order("occurred_at", { ascending: false })
        .limit(30),
    ]);
    if (transactionResult.error) throw transactionResult.error;
    setDevices(deviceResult.devices ?? []);
    setTransactions((transactionResult.data ?? []) as CloudTransaction[]);
  }, [session]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadCloudData().catch(() => setMessage("目前無法讀取雲端帳本資料。"));
  }, [session, loadCloudData]);

  const signIn = async () => {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/connect`,
        shouldCreateUser: true,
      },
    });
    setBusy(false);
    setMessage(error ? "登入信寄送失敗，請稍後重試。" : "登入連結已寄出，請回到這支 iPhone 開啟。");
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
      setMessage("✅ 已記帳。這筆資料只會出現在你的帳本。");
      await loadCloudData();
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

  return (
    <main className="ledger-site">
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

        <div className="ls-connect-card ls-connect-hero">
          <span className="ls-connect-icon"><Cloud size={24} /></span>
          <p className="ls-eyebrow">Free beta · multi-tenant</p>
          <h1>你的帳本，不需要一台電腦永遠開著。</h1>
          <p className="ls-connect-lead">
            免費建立自己的雲端 Ledger。手動記帳立即可用；iPhone 配對後，再把支援的 Wallet 交易自動送進同一個帳本。
          </p>
          <div className="ls-connect-trust">
            <span><ShieldCheck size={16} /> 每位使用者資料由 RLS 隔離</span>
            <span><Smartphone size={16} /> 裝置憑證可獨立撤銷</span>
            <span><CheckCircle2 size={16} /> 免費方案不要求銀行帳密</span>
          </div>
        </div>

        {!session ? (
          <div className="ls-connect-card">
            <span className="ls-step-chip">01</span>
            <h2>免費建立 Ledger</h2>
            <p>輸入 Email 取得一次性登入連結。系統不會要求銀行帳密或 Apple ID 密碼。</p>
            <div className="ls-connect-form">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-label="Email"
              />
              <button className="ls-button ls-primary" disabled={busy || !email.trim()} onClick={() => void signIn()}>
                寄登入連結
              </button>
            </div>
          </div>
        ) : (
          <>
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
                            {timeLabel(tx.occurred_at)} · {sourceLabel(tx.source)}
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
          這是免費 Beta。Cloud Ledger 與你自己的 M4 私人 Ledger 使用不同資料庫與憑證；不會把既有私人帳本自動搬上雲端。
        </p>
      </section>
    </main>
  );
}

export default CloudConnect;
