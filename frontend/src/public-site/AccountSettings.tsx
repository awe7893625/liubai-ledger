import { useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { CloudPreferences } from "./cloud-preferences";
import "./account-settings.css";

type Option = { id: string; name: string };
type Props = {
  session: Session; client: SupabaseClient; onSignOut: () => void;
  preferences: CloudPreferences; accounts: Option[]; categories: Option[]; ready: boolean;
  onPreferencesChanged: (next: CloudPreferences) => void;
};
export function AccountSettings({ session, client, onSignOut, preferences, accounts, categories, ready, onPreferencesChanged }: Props) {
  const base = session.user.user_metadata?.display_name || session.user.user_metadata?.username || "使用者";
  const passwordAccount = session.user.email?.endsWith("@users.liubai.invalid") && session.user.user_metadata?.provider !== "google";
  const [draft, setDraft] = useState(preferences);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const mounted = useRef(true); const lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setDraft(preferences); }, [preferences]);

  const request = async (method: "GET" | "PUT") => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch("/api/v2/preferences", { method, signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify(draft) } : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.preferences) throw new Error(result.error || "尚未確認設定結果");
      if (!mounted.current) return;
      onPreferencesChanged(result.preferences); setDraft(result.preferences);
      setNotice(method === "PUT" ? "已儲存到雲端，設定立即生效；其他裝置重新載入即可同步。" : "已重新載入雲端設定。");
    } catch (error) {
      if (mounted.current) setNotice(controller.signal.aborted ? "連線逾時，請重新載入確認，勿重複覆蓋。" : error instanceof Error ? error.message : "設定更新失敗");
    } finally { window.clearTimeout(timer); lock.current = false; if (mounted.current) setBusy(false); }
  };
  const changePassword = async () => {
    if (!passwordAccount || lock.current) return;
    if (newPassword.length < 12 || newPassword.length > 128 || newPassword !== confirmPassword || currentPassword === newPassword) {
      setNotice("新密碼需 12–128 字元、兩次一致，且不可與原密碼相同。"); return;
    }
    lock.current = true; setBusy(true); setNotice("");
    try {
      const username = session.user.user_metadata?.username;
      if (typeof username !== "string" || !username) throw new Error("請重新登入確認帳號。");
      const response = await fetch("/api/v2/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: currentPassword }) });
      if (!response.ok) throw new Error("原密碼不正確，或嘗試過於頻繁。");
      const result = await response.json();
      if (!result.session?.access_token || !result.session?.refresh_token) throw new Error("重新驗證未完成");
      const verified = await client.auth.getUser(result.session.access_token);
      if (verified.error || verified.data.user?.id !== session.user.id) throw new Error("重新驗證帳號不符，請重新登入。");
      if (!mounted.current) return;
      const renewed = await client.auth.setSession(result.session);
      if (renewed.error) throw renewed.error;
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      if (mounted.current) { setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setNotice("密碼已更新，請妥善保存原本的復原碼。"); }
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : "密碼更新失敗"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const signOutOthers = async () => {
    if (busy || !window.confirm("取消其他瀏覽器登入的續期？目前這台保留登入，已配對的 iPhone 捷徑不受影響。")) return;
    setBusy(true); setNotice("");
    try {
      const { error } = await client.auth.signOut({ scope: "others" });
      if (error) throw error;
      setNotice("其他登入的續期已取消；已發出的存取權杖到期前仍可能有效。捷徑裝置需在 iPhone 設定另行解除。");
    } catch { setNotice("未完成登出其他瀏覽器，請稍後再試。"); }
    finally { setBusy(false); }
  };
  return <section className="ls-general-settings" aria-label="一般設定">
    <div className="ls-general-heading"><p>ACCOUNT & PREFERENCES</p><h2>帳號與一般設定</h2><span>偏好跟著帳號，不只留在這台手機。</span></div>
    <form className="ls-general-card" onSubmit={(event) => { event.preventDefault(); void request("PUT"); }}>
      <h3>個人化帳本</h3>
      <div className="ls-general-identity"><div className="ls-general-avatar">{String(draft.display_name || base).slice(0, 1)}</div><div><strong>{draft.display_name || base}</strong><small>{passwordAccount ? "帳號密碼登入" : "Google 登入"} · 免費帳本</small></div></div>
      <label>顯示暱稱<input aria-label="顯示暱稱" maxLength={40} value={draft.display_name} onChange={(event) => setDraft({ ...draft, display_name: event.target.value })} placeholder={base} /></label>
      <small>留白使用原始名稱；不會變更 Google 帳號或登入名稱。</small>
      <div className="ls-general-grid">
        <label>顯示模式<select aria-label="顯示模式" value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as CloudPreferences["theme"] })}><option value="system">跟隨系統</option><option value="light">明亮</option><option value="dark">深色</option></select></label>
        <label>預設檢視幣別<select aria-label="預設檢視幣別" value={draft.home_currency} onChange={(event) => setDraft({ ...draft, home_currency: event.target.value })}>{[...new Set([draft.home_currency, "TWD", "USD", "JPY", "EUR", "HKD"])].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
        <label>預設付款帳戶<select aria-label="預設付款帳戶" value={draft.default_account_id || ""} onChange={(event) => setDraft({ ...draft, default_account_id: event.target.value || null })}><option value="">不指定</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>預設分類<select aria-label="預設分類" value={draft.default_category_id || ""} onChange={(event) => setDraft({ ...draft, default_category_id: event.target.value || null })}><option value="">使用其他分類</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      </div>
      <small>檢視幣別不會換匯或修改交易。網頁新增交易的幣別由付款帳戶決定；捷徑仍沿用每次選擇的付款方式。</small>
      <div className="ls-general-links"><button className="ls-button ls-primary" type="submit" disabled={!ready || busy}>{busy ? "處理中…" : "儲存一般設定"}</button><button className="ls-button ls-secondary" type="button" disabled={busy} onClick={() => void request("GET")}>重新載入設定</button></div>
      <small>{preferences.updated_at ? `雲端設定版本 ${preferences.version}` : "尚未儲存個人偏好"}</small>
    </form>
    <div className="ls-general-card"><h3>登入與安全</h3>
      {passwordAccount ? <><p>更新密碼前會重新驗證原密碼。</p><div className="ls-general-grid"><label>目前密碼<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密碼<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label>再次輸入新密碼<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></div><button className="ls-button ls-secondary" disabled={busy || !currentPassword || !newPassword} onClick={() => void changePassword()}>更新密碼</button><p>忘記密碼可在登入頁使用先前保存的復原碼。</p></> : <><p>Google 密碼和復原方式請到 Google 帳號管理；Ledger 不保存你的 Google 密碼。</p><a className="ls-general-link" href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer">Google 帳號安全中心</a></>}
      <button className="ls-button ls-secondary" type="button" onClick={onSignOut}>登出這台裝置</button><button className="ls-button ls-secondary" type="button" disabled={busy} onClick={() => void signOutOthers()}>登出其他瀏覽器</button>
    </div>
    <div className="ls-general-card"><h3>資料與隱私</h3><p>交易頁可下載 CSV。需刪除帳號時，提出申請後會先驗證所有權。</p><div className="ls-general-links"><a href="/privacy">隱私權政策</a><a href="/terms">服務條款</a><a href="mailto:asdapper8866@gmail.com?subject=Ledger%20Account%20Deletion">申請刪除帳號</a></div></div>
    {notice ? <p className="ls-general-notice" role="status">{notice}</p> : null}
  </section>;
}
