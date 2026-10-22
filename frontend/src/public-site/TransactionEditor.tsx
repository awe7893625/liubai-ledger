import { useEffect, useRef, useState } from "react";

type Row = { id: string; merchant: string | null; amount_minor: number | null; currency: string; account_id: string | null; category_id: string | null; note: string | null; occurred_at: string; legacy_date?: string | null; status: string; updated_at?: string };
type Props = { transaction: Row; accounts: { id: string; name: string; currency: string }[]; categories: { id: string; name: string }[]; onSave: (patch: Record<string, unknown>) => Promise<void>; onClose: () => void };
function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function TransactionEditor({ transaction: tx, accounts, categories, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [merchant, setMerchant] = useState(tx.merchant || "");
  const [amount, setAmount] = useState(tx.amount_minor === null ? "" : (Math.abs(tx.amount_minor) / 100).toFixed(2));
  const [accountId, setAccountId] = useState(tx.account_id || "");
  const [categoryId, setCategoryId] = useState(tx.category_id || "");
  const [note, setNote] = useState(tx.note || "");
  const initialDate = tx.legacy_date || localDateTime(tx.occurred_at);
  const [date, setDate] = useState(initialDate);
  const [status, setStatus] = useState(tx.status === "confirmed" ? "confirmed" : "pending");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const save = async () => {
    if (lock.current) return;
    if (!merchant.trim() || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim()) || Number(amount) <= 0 || !Number.isSafeInteger(Math.round(Number(amount) * 100))) { setError("請輸入商家與有效的正數金額。"); return; }
    const patch: Record<string, unknown> = { merchant: merchant.trim(), amount: amount.trim(),
      direction: (tx.amount_minor ?? -1) > 0 ? "income" : "expense", account_id: accountId || null,
      category_id: categoryId || null, note, status, expected_updated_at: tx.updated_at };
    if (date !== initialDate) {
      if (tx.legacy_date) patch.date = date;
      else {
        if (!date || Number.isNaN(Date.parse(date))) { setError("交易日期不正確。"); return; }
        patch.occurred_at = new Date(date).toISOString();
      }
    }
    lock.current = true; setSaving(true); setError("");
    try { await onSave(patch); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "更新失敗，內容已保留。"); }
    finally { lock.current = false; setSaving(false); }
  };
  return <dialog ref={dialog} className="ls-editor-dialog" aria-labelledby="ledger-edit-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="ledger-edit-title">編輯交易</h2><p>{tx.currency} · 保留原始來源與收支類型</p></div><button type="button" className="ls-editor-close" aria-label="關閉編輯" disabled={saving} onClick={onClose}>×</button></header>
      <label>商家／用途<input aria-label="編輯商家" autoFocus value={merchant} maxLength={240} onChange={(event) => setMerchant(event.target.value)} required /></label>
      <div className="ls-editor-fields"><label>金額（{tx.currency}）<input aria-label="編輯金額" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>交易{tx.legacy_date ? "日期" : "時間"}<input aria-label="編輯日期" type={tx.legacy_date ? "date" : "datetime-local"} value={date} onChange={(event) => setDate(event.target.value)} required /></label><label>分類<select aria-label="編輯分類" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分類</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>帳戶<select aria-label="編輯帳戶" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">未指定</option>{accounts.filter((account) => account.currency.trim() === tx.currency.trim()).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label></div>
      <label>狀態<select aria-label="編輯狀態" value={status} onChange={(event) => setStatus(event.target.value)}><option value="confirmed">已確認</option><option value="pending">待確認</option></select></label>
      <label>備註<textarea aria-label="編輯備註" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
      {error ? <p role="alert" className="ls-editor-error">{error}</p> : null}
      <footer><button type="button" className="ls-button ls-secondary" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="ls-button ls-primary" disabled={saving}>{saving ? "儲存中…" : "儲存變更"}</button></footer>
    </form>
  </dialog>;
}
