import { useEffect, useRef, useState } from "react";
import { entryKind, entryDirection, ENTRY_LABELS } from "./transaction-integrity";
import type { EntryKind } from "./transaction-integrity";

type Row = { id: string; merchant: string | null; amount_minor: number | null; currency: string; account_id: string | null; category_id: string | null; note: string | null; occurred_at: string; legacy_date?: string | null; legacy_kind?: string | null; status: string; updated_at?: string };
type Props = { transaction: Row; accounts: { id: string; name: string; currency: string }[]; categories: { id: string; name: string }[]; onSave: (patch: Record<string, unknown>) => Promise<void>; onClose: () => void };
function localDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function TransactionEditor({ transaction: tx, accounts, categories, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [merchant, setMerchant] = useState(tx.merchant || "");
  const [amount, setAmount] = useState(tx.amount_minor === null ? "" : (Math.abs(tx.amount_minor) / 100).toFixed(2));
  const [kind, setKind] = useState<EntryKind>(() => entryKind(tx));
  const [flow, setFlow] = useState<"income" | "expense">((tx.amount_minor ?? -1) > 0 ? "income" : "expense");
  const [accountId, setAccountId] = useState(tx.account_id || "");
  const [categoryId, setCategoryId] = useState(tx.category_id || "");
  const [note, setNote] = useState(tx.note || "");
  const initialDate = tx.legacy_date || localDateTime(tx.occurred_at);
  const [date, setDate] = useState(initialDate);
  const [status, setStatus] = useState(["confirmed", "pending", "duplicate"].includes(tx.status) ? tx.status : "pending");
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
    const text = amount.trim();
    if (text && (!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text) <= 0 || !Number.isSafeInteger(Math.round(Number(text) * 100)))) { setError("金額需為正數，最多兩位小數。"); return; }
    if (status === "confirmed" && (!merchant.trim() || !text)) { setError("商家與金額完整後，才能標為已確認。"); return; }
    if ((!text && tx.amount_minor !== null) || (!merchant.trim() && tx.merchant)) { setError("已有的商家或金額不可清空；只排除重複時請保留原始內容。"); return; }
    const patch: Record<string, unknown> = { kind, direction: entryDirection(kind, flow), account_id: accountId || null,
      category_id: categoryId || null, note, status, expected_updated_at: tx.updated_at };
    if (merchant.trim()) patch.merchant = merchant.trim();
    if (text) patch.amount = text;
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
      <header><div><h2 id="ledger-edit-title">編輯交易</h2><p>{tx.currency} · 保留原始來源；收支依你確認的類型計算</p></div><button type="button" className="ls-editor-close" aria-label="關閉編輯" disabled={saving} onClick={onClose}>×</button></header>
      <label>商家／用途<input aria-label="編輯商家" autoFocus value={merchant} maxLength={240} onChange={(event) => setMerchant(event.target.value)} required={status === "confirmed"} /></label>
      <div className="ls-editor-fields">
        <label>交易類型<select aria-label="編輯交易類型" value={kind} onChange={(event) => setKind(event.target.value as EntryKind)}>{Object.entries(ENTRY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {kind === "transfer" ? <label>本帳戶方向<select aria-label="轉帳方向" value={flow} onChange={(event) => setFlow(event.target.value as "income" | "expense")}><option value="expense">轉出</option><option value="income">轉入</option></select></label> : null}
        <label>金額（{tx.currency}）<input aria-label="編輯金額" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required={status === "confirmed"} /></label>
        <label>交易{tx.legacy_date ? "日期" : "時間"}<input aria-label="編輯日期" type={tx.legacy_date ? "date" : "datetime-local"} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label>分類<select aria-label="編輯分類" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分類</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>帳戶<select aria-label="編輯帳戶" value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">未指定</option>{accounts.filter((account) => account.currency.trim() === tx.currency.trim()).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </div>
      {kind === "refund" ? <p className="ti-kind-note">退款以正數記錄，沖減淨支出，不算薪資或其他收入。</p> : kind === "transfer" ? <p className="ti-kind-note">只標記這筆為帳戶移動，不計收入／支出；不替銀行轉帳，也不會建立另一帳戶的對應分錄。</p> : null}
      <label>狀態<select aria-label="編輯狀態" value={status} onChange={(event) => setStatus(event.target.value)}><option value="confirmed">已確認</option><option value="pending">待確認</option><option value="duplicate">重複（不計入收支）</option></select></label>
      {status === "duplicate" ? <p className="ti-kind-note">保留紀錄但排除收支；不會刪除資料。確認不是重複時，可改回已確認。</p> : null}
      <label>備註<textarea aria-label="編輯備註" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} rows={3} /></label>
      {error ? <p role="alert" className="ls-editor-error">{error}</p> : null}
      <footer><button type="button" className="ls-button ls-secondary" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="ls-button ls-primary" disabled={saving}>{saving ? "儲存中…" : "儲存變更"}</button></footer>
    </form>
  </dialog>;
}
