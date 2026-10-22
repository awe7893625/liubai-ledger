import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, Pencil, X } from "lucide-react";
import "./payment-settings.css";

type Account = { id: string; name: string; type: string; issuer: string | null; currency: string; card_aliases: string[] };
const typeNames: Record<string, string> = { card: "信用卡", cash: "現金", bank: "銀行／轉帳", wallet: "電子支付", other: "其他" };

export function PaymentSettings({ session, onChanged }: { session: Session; onChanged: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("card");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const request = useCallback(async (method = "GET", body?: Record<string, unknown>) => {
    const res = await fetch("/api/v2/accounts", {
      method, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) throw new Error(data.error || "付款方式暫時無法儲存");
    return data;
  }, [session.access_token]);

  const reload = useCallback(async () => {
    const data = await request();
    setAccounts(data.accounts || []);
  }, [request]);
  useEffect(() => {
    setLoading(true);
    void reload().catch(() => setMessage("無法載入付款方式，請重新整理。")).finally(() => setLoading(false));
  }, [reload]);

  const edit = (account?: Account) => {
    setEditId(account?.id || null);
    setName(account?.name || ""); setType(account?.type || "card");
    setAliases((account?.card_aliases || []).join("\n"));
    setMessage(""); setFormOpen(true);
  };
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await request(editId ? "PATCH" : "POST", {
        ...(editId ? { id: editId } : {}), name, type, currency: "TWD",
        card_aliases: aliases.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean),
      });
      setFormOpen(false);
      await reload(); await onChanged();
      setMessage("已儲存。手動捷徑下次執行會自動取得最新清單。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "儲存失敗"); }
    finally { setBusy(false); }
  };
  return (
    <section className="ls-payment-panel ls-app-card" aria-label="付款方式設定">
      <div className="ls-payment-heading"><div><h2>我的信用卡與付款方式</h2><p>每個帳號獨立設定，不限銀行，不需要完整卡號。</p></div>
        <button type="button" className="ls-button ls-secondary" onClick={() => edit()}><Plus size={16} />新增</button></div>
      {loading ? <p role="status">載入中…</p> : <div className="ls-payment-list">{accounts.map((a) => (
        <div className="ls-payment-row" key={a.id}><CreditCard size={18} /><div><strong>{a.name}</strong>
          <small>{typeNames[a.type] || a.type} · {a.currency}</small>
          {a.card_aliases?.length > 0 ? <small>Wallet：{a.card_aliases.join("、")}</small> : null}</div>
          <button className="ls-payment-edit" type="button" aria-label={`編輯 ${a.name}`} onClick={() => edit(a)}><Pencil size={16} /></button></div>
      ))}</div>}
      {formOpen ? <form className="ls-payment-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="ls-payment-heading"><strong>{editId ? "編輯付款方式" : "新增付款方式"}</strong><button type="button" className="ls-payment-edit" aria-label="關閉付款方式表單" onClick={() => setFormOpen(false)}><X size={16} /></button></div>
        <label>名稱<input value={name} maxLength={80} required placeholder="例如：旅行用 Visa／日常現金" onChange={(e) => setName(e.target.value)} /></label>
        <label>類型<select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(typeNames).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <label>Wallet 別名（選填，一行一個）<textarea value={aliases} rows={2} onChange={(e) => setAliases(e.target.value)} placeholder="填入捷徑取得的卡片名稱；不要輸入完整卡號" /></label>
        <p>同銀行多張卡請用不同暱稱。別名須精確對應；無法辨識時保留原始卡名，不會猜到別人的帳戶。</p>
        <button className="ls-button ls-primary" disabled={busy || !name.trim()} type="submit">{busy ? "儲存中…" : "儲存付款方式"}</button>
      </form> : null}
      {message ? <p className="ls-payment-message" role="status">{message}</p> : null}
    </section>
  );
}
