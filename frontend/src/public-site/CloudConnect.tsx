import { createClient, type Session } from "@supabase/supabase-js";
import { CheckCircle2, Cloud, Link2, LogOut, ShieldCheck, Smartphone, Unplug } from "lucide-react";
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

type PairStart = {
  pair_ticket: string;
  expires_at: string;
};

type CloudTransaction = {
  id: string;
  amount_minor: number | null;
  currency: string;
  merchant: string | null;
  card_label: string | null;
  status: "pending" | "confirmed" | "duplicate" | "error";
  occurred_at: string;
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
  const paired = useMemo(() => new URLSearchParams(window.location.search).get("paired") === "1", []);

  const loadCloudData = useCallback(async () => {
    if (!supabase || !session) return;
    const [deviceResult, transactionResult] = await Promise.all([
      cloudRequest<{ ok: boolean; devices: Device[] }>("/api/v2/devices", session),
      supabase
        .from("ledger_transactions")
        .select("id,amount_minor,currency,merchant,card_label,status,occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(12),
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
      options: { emailRedirectTo: `${window.location.origin}/connect` },
    });
    setBusy(false);
    setMessage(error ? "登入信寄送失敗，請稍後重試。" : "登入連結已寄出，請回到這支 iPhone 開啟。");
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
            <p className="ls-eyebrow">Cloud v2 · isolated preview</p>
            <h1>雲端自動記帳尚未啟用</h1>
            <p>這個 build 沒有雲端專案設定，所以不會碰正式帳本。部署獨立 Supabase 後才會開放連接。</p>
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
          <p className="ls-eyebrow">Apple Pay · Cloud</p>
          <h1>不用電腦，也不用貼 Token。</h1>
          <p className="ls-connect-lead">
            iPhone 第一次連接完成後，Apple Pay 交易會直接送到你的雲端 Ledger。
            你的私人自架帳本與既有捷徑不會被改動。
          </p>
          <div className="ls-connect-trust">
            <span><ShieldCheck size={16} /> 一次性配對票券</span>
            <span><Smartphone size={16} /> 每台裝置可獨立撤銷</span>
            <span><CheckCircle2 size={16} /> 不需要 Mac / Tailscale</span>
          </div>
        </div>

        {!session ? (
          <div className="ls-connect-card">
            <span className="ls-step-chip">01</span>
            <h2>先登入你的 Ledger</h2>
            <p>輸入 Email，我們只寄一次性登入連結。不要在這裡填銀行帳密或 Apple ID 密碼。</p>
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
            <div className="ls-connect-grid">
              <div className="ls-connect-card">
                <span className="ls-step-chip">01</span>
                <h2>安裝留白自動記帳</h2>
                <p>同一份公開捷徑，不內建你的帳號、API Token 或作者的私人網址。</p>
                <a className="ls-button ls-secondary" href="/shortcuts/Liubai-Cloud.shortcut" download>
                  安裝捷徑
                </a>
              </div>
              <div className="ls-connect-card">
                <span className="ls-step-chip">02</span>
                <h2>連接這支 iPhone</h2>
                <p>建立 10 分鐘、只能使用一次的票券，直接交給捷徑交換裝置憑證。</p>
                <button className="ls-button ls-primary" disabled={busy} onClick={() => void startPairing()}>
                  <Link2 size={17} /> 連接這支 iPhone
                </button>
                {ticket ? <small>票券到期：{timeLabel(ticket.expires_at)}</small> : null}
              </div>
            </div>

            <div className="ls-connect-card">
              <span className="ls-step-chip">03</span>
              <h2>選 Apple Pay 卡片</h2>
              <p>捷徑 App → 自動化 → 交易 → 選要記錄的卡片 → 立即執行。這一步由 iPhone 本人授權，網站不會代選。</p>
            </div>
            <div className="ls-connect-card">
              <div className="ls-connect-card-head">
                <div>
                  <p className="ls-eyebrow">Devices</p>
                  <h2>已連接裝置</h2>
                </div>
                {paired ? <span className="ls-success-pill"><CheckCircle2 size={15} /> 配對完成</span> : null}
              </div>
              {devices.filter((d) => !d.revoked_at).length === 0 ? (
                <p className="ls-connect-muted">目前沒有已啟用的裝置。</p>
              ) : (
                <div className="ls-device-list">
                  {devices.filter((d) => !d.revoked_at).map((device) => (
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
                  <p className="ls-eyebrow">Recent activity</p>
                  <h2>最近自動記帳</h2>
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
                <p className="ls-connect-muted">還沒有雲端交易。完成卡片自動化後，下一筆 Apple Pay 會出現在這裡。</p>
              ) : (
                <div className="ls-cloud-tx-list">
                  {transactions.map((tx) => (
                    <article className="ls-cloud-tx-row" key={tx.id}>
                      <div>
                        <strong>{tx.merchant || "未取得商家"}</strong>
                        <small>{timeLabel(tx.occurred_at)} · {tx.card_label || "未指定卡片"}</small>
                      </div>
                      <div className="ls-cloud-tx-meta">
                        <strong>{moneyLabel(tx)}</strong>
                        <span data-status={tx.status}>{statusLabel(tx.status)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {message ? <p className="ls-connect-message" role="status">{message}</p> : null}
        <p className="ls-connect-footnote">Cloud v2 與現行私人 Ledger 使用不同 API、不同裝置憑證與不同資料庫。</p>
      </section>
    </main>
  );
}

export default CloudConnect;
