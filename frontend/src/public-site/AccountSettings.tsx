import { useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import "./account-settings.css";

type Props = { session: Session; client: SupabaseClient; onSignOut: () => void };

export function AccountSettings({ session, client, onSignOut }: Props) {
  const uid = session.user.id;
  const passwordAccount = session.user.email?.endsWith("@users.liubai.invalid") && session.user.user_metadata?.provider !== "google";
  const base = session.user.user_metadata?.display_name || session.user.user_metadata?.username || "使用者";
  const stored = (key: string) => { try { return localStorage.getItem(`ledger-settings:${uid}:${key}`); } catch { return null; } };
  const [nickname, setNickname] = useState(() => stored("nickname") || base);
  const [theme, setTheme] = useState(() => stored("theme") || "system");
  const [currency, setCurrency] = useState(() => stored("currency") || "TWD");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saveLocal = (key: string, value: string) => {
    try { localStorage.setItem(`ledger-settings:${uid}:${key}`, value); setNotice("已儲存到這台裝置。"); }
    catch { setNotice("這個瀏覽器不允許儲存偏好。"); }
  };
  const changePassword = async () => {
    if (!passwordAccount || busy) return;
    if (newPassword.length < 12 || newPassword.length > 128 || newPassword !== confirmPassword) {
      setNotice("新密碼需 12–128 字元，且兩次輸入必須一致。"); return;
    }
    if (currentPassword === newPassword) { setNotice("新密碼不得與原密碼相同。"); return; }
    setBusy(true); setNotice("");
    try {
      const username = session.user.user_metadata?.username;
      if (typeof username !== "string" || !username) throw new Error("帳號識別不完整，請重新登入。");
      const response = await fetch("/api/v2/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: currentPassword }) });
      if (!response.ok) throw new Error("目前密碼不正確，或嘗試次數過多。");
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setNotice("密碼已更新。若其他裝置仍登入，請在帳號安全頁登出所有裝置。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "密碼更新失敗。"); }
    finally { setBusy(false); }
  };
  return <section className="ls-general-settings" aria-label="一般設定">
    <div className="ls-general-heading"><p>GENERAL SETTINGS</p><h2>帳號與一般設定</h2><span>個人資料、顯示偏好和安全選項。</span></div>
    <div className="ls-general-card">
      <h3>帳號資訊</h3>
      <div className="ls-general-identity"><div className="ls-general-avatar">{String(nickname).slice(0,1)}</div><div><strong>{nickname}</strong><small>{passwordAccount ? "帳號密碼登入" : "Google 登入"} · 免費帳本</small></div></div>
      <label>顯示暱稱<input aria-label="顯示暱稱" maxLength={40} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="你希望在這台裝置看到的名稱" /></label>
      <button className="ls-button ls-secondary" type="button" onClick={() => { const name=nickname.trim(); if (!name) {setNotice("暱稱不可留白。");return;}saveLocal("nickname",name); }}>儲存暱稱</button>
      <small>暱稱目前只會儲存在這台裝置，不會改變 Google 名稱或登入帳號。</small>
    </div>
    <div className="ls-general-card">
      <h3>顯示與記帳偏好</h3><div className="ls-general-grid">
        <label>顯示模式<select aria-label="顯示模式" value={theme} onChange={e=>{setTheme(e.target.value);saveLocal("theme",e.target.value);}}><option value="system">跟隨系統（目前網站配色）</option><option value="light">偏好明亮</option><option value="dark">偏好深色</option></select></label>
        <label>預設檢視幣別<select aria-label="預設檢視幣別" value={currency} onChange={e=>{setCurrency(e.target.value);saveLocal("currency",e.target.value);}}><option value="TWD">TWD 新台幣</option><option value="USD">USD 美元</option><option value="JPY">JPY 日圓</option></select></label>
      </div>
      <small>目前只儲存偏好，未全面切換深色主題，也不會轉換交易幣別或匯率。</small>
    </div>
    <div className="ls-general-card">
      <h3>登入與安全</h3>
      {passwordAccount ? <><p>以原密碼驗證後設定新密碼；復原碼仍請妥善保管。</p>
        <div className="ls-general-grid">
          <label>目前密碼<input aria-label="目前密碼" type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} /></label>
          <label>新密碼<input aria-label="新密碼" type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></label>
          <label>再次輸入新密碼<input aria-label="再次輸入新密碼" type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} /></label>
        </div><button className="ls-button ls-primary" disabled={busy || !currentPassword || !newPassword} onClick={()=>void changePassword()}>{busy?"驗證中…":"更新密碼"}</button>
        <p>忘記密碼？登出後可使用先前保存的復原碼重設。</p>
      </> : <p>此帳號由 Google 驗證身份。若要修改 Google 密碼或復原方式，請使用 Google 帳號的安全設定。</p>}
      <button className="ls-button ls-secondary" type="button" onClick={onSignOut}>登出這台裝置</button>
      <a className="ls-general-link" href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer">Google 帳號安全中心</a>
    </div>
    <div className="ls-general-card"><h3>資料與隱私</h3><p>「交易」頁可篩選、下載 CSV；若要刪除整個帳號與交易，需先驗證所有權。</p>
      <div className="ls-general-links"><a href="/privacy">隱私權政策</a><a href="/terms">服務條款</a><a href="mailto:asdapper8866@gmail.com?subject=Ledger%20Account%20Deletion">申請刪除帳號</a></div>
    </div>
    {notice ? <p className="ls-general-notice" role="status">{notice}</p> : null}
  </section>;
}
