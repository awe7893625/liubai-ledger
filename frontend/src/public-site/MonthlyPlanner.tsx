import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BudgetPanel } from "./BudgetPanel";
import { ledgerDay } from "./ledger-data";
import type { LedgerRow } from "./ledger-data";
import "./monthly-planner.css";

type Option = { id: string; name: string; currency?: string };
type Plan = {
  id: string; name: string; amount_minor: number; currency: string; recurrence: "once" | "monthly";
  start_month: string; end_month: string | null; due_day: number; account_id: string | null; category_id: string | null;
  active: boolean; version: number; state: "open" | "paid" | "skipped" | "paused"; due_date: string;
  outstanding_minor: number; receipt_version: number; linked_transaction_id: string | null;
  linked_amount_minor: number | null; payment_needs_review: boolean;
};
type Draft = { id: string; name: string; amount: string; recurrence: "once" | "monthly"; start_month: string; end_month: string; due_day: number; account_id: string; category_id: string; active: boolean; version: number };
type Response = { ok: boolean; items?: Plan[]; outstanding_minor?: number; error?: string };
type Props = { session: Session; month: string; currency: string; transactions: LedgerRow[]; categories: Option[]; accounts: Option[]; dataReady: boolean };
const amountLabel = (minor: number, currency: string) => `${currency === "TWD" ? "NT$" : currency + " "}${(minor / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
const planDraft = (plan: Plan): Draft => ({ id: plan.id, name: plan.name, amount: (plan.amount_minor / 100).toFixed(2), recurrence: plan.recurrence, start_month: plan.start_month, end_month: plan.end_month || "", due_day: plan.due_day, account_id: plan.account_id || "", category_id: plan.category_id || "", active: plan.active, version: plan.version });

export function MonthlyPlanner({ session, month, currency, transactions, categories, accounts, dataReady }: Props) {
  const [items, setItems] = useState<Plan[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [linking, setLinking] = useState<Plan | null>(null);
  const [paymentId, setPaymentId] = useState("");
  const mounted = useRef(true); const lock = useRef(false); const generation = useRef(0);
  const request = useCallback(async (method: string, body?: object): Promise<Response> => {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const query = new URLSearchParams({ month, currency });
      const response = await fetch(`/api/v2/planning?${query}`, { method, signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "預留資料處理失敗");
      return result;
    } catch (failure) { if (controller.signal.aborted) throw new Error("連線逾時，請重新載入確認結果。"); throw failure; }
    finally { window.clearTimeout(timer); }
  }, [session.access_token, month, currency]);
  const load = useCallback(async () => {
    const ticket = ++generation.current; setLoading(true); setError("");
    try {
      const result = await request("GET");
      if (!Array.isArray(result.items) || !Number.isSafeInteger(result.outstanding_minor)) throw new Error("預留清單不完整，暫不計算可用額");
      if (!mounted.current || generation.current !== ticket) return;
      setItems(result.items); setOutstanding(result.outstanding_minor!);
    } catch (failure) { if (mounted.current && generation.current === ticket) setError(failure instanceof Error ? failure.message : "載入失敗"); }
    finally { if (mounted.current && generation.current === ticket) setLoading(false); }
  }, [request]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load, transactions]);
  const payments = useMemo(() => transactions.filter((row) => row.status === "confirmed" && row.amount_minor !== null && row.amount_minor < 0 && !["transfer", "refund"].includes(row.legacy_kind || "") && row.currency.trim() === currency && ledgerDay(row).slice(0, 7) === month), [transactions, month, currency]);

  const mutate = async (method: string, body: object, message: string) => {
    if (lock.current || loading || error) return;
    lock.current = true; setSaving(true); setNotice("");
    try {
      await request(method, body);
      if (mounted.current) { setDraft(null); setLinking(null); setPaymentId(""); setNotice(message); await load(); }
    } catch (failure) { if (mounted.current) setNotice(failure instanceof Error ? failure.message : "結果尚未確認，請重新載入"); }
    finally { lock.current = false; if (mounted.current) setSaving(false); }
  };
  const startNew = () => {
    setNotice(""); setLinking(null);
    setDraft({ id: crypto.randomUUID(), name: "", amount: "", recurrence: "monthly", start_month: month, end_month: "", due_day: 1, account_id: "", category_id: "", active: true, version: 0 });
  };
  const save = () => {
    if (!draft || !draft.name.trim() || !/^\d+(?:\.\d{1,2})?$/.test(draft.amount) || Number(draft.amount) <= 0) { setNotice("請填項目名稱與正數金額，最多兩位小數。"); return; }
    void mutate(draft.version ? "PUT" : "POST", { ...draft, currency, end_month: draft.recurrence === "once" ? null : draft.end_month || null, account_id: draft.account_id || null, category_id: draft.category_id || null }, "預留項目已儲存；不會扣款，也沒有新增交易。");
  };
  const receipt = (plan: Plan, status: string, transaction_id?: string) => void mutate("PATCH", { plan_id: plan.id, month, version: plan.receipt_version, status, transaction_id }, status === "linked" ? "本期已連結實際交易，預留已解除，沒有重複記帳。" : status === "skipped" ? "本期已略過，之後月份不受影響。" : "本期已恢復預留，原交易仍保留。");
  const toggle = (plan: Plan) => {
    if (!plan.active || window.confirm(`暫停「${plan.name}」所有未結算預留？不會刪除實際交易。`)) {
      const values = planDraft(plan);
      void mutate("PUT", { ...values, currency, active: !plan.active, end_month: values.end_month || null, account_id: values.account_id || null, category_id: values.category_id || null }, plan.active ? "已暫停此項目；實際交易保留。" : "已恢復預留項目。");
    }
  };
  const controlsDisabled = saving || loading || Boolean(error);
  return <div className="ls-monthly-planner">
    <BudgetPanel session={session} month={month} currency={currency} transactions={transactions} categories={categories} dataReady={dataReady} scheduledOutstanding={outstanding} scheduledReady={!loading && !error} />
    <section className="ls-scheduled" aria-label="預留與固定支出" data-month={month}>
      <header><div><p>{month} · {currency}</p><h2>預留與固定支出</h2></div><button type="button" className="ls-button ls-secondary" disabled={saving || loading} onClick={() => { setDraft(null); setLinking(null); void load(); }}>重新載入預留</button></header>
      <p className="ls-scheduled-summary">{loading ? "正在載入…" : error ? "暫無法確認預留總額" : `本期尚待支出 ${amountLabel(outstanding, currency)}`}<small>預留不是實際交易；付款後請連結已記帳的交易，不會再新增一筆。</small></p>
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error ? <>
        {!items.length ? <p className="ls-scheduled-empty">可預留一次性支出，或建立每月房租、訂閱等項目。每月項目在有效月份會自動列出。</p> : <div className="ls-scheduled-list">{items.map((plan) => <article key={plan.id} data-state={plan.state}>
          <div className="ls-scheduled-main"><div><strong>{plan.name}</strong><small>{plan.due_date} · {plan.recurrence === "monthly" ? "每月" : "單次"}{plan.end_month ? ` · 至 ${plan.end_month}` : ""}</small></div><div><b>{amountLabel(plan.amount_minor, currency)}</b><small>{({ open: "待付款", paid: "本期已付", skipped: "本期略過", paused: "已暫停" })[plan.state]}</small></div></div>
          {plan.payment_needs_review ? <p className="ls-scheduled-warning">原連結交易已刪除或不再符合條件，已恢復預留，請重新確認。</p> : null}
          {plan.state === "paid" && plan.linked_amount_minor !== plan.amount_minor ? <p>實際付款 {amountLabel(plan.linked_amount_minor || 0, currency)}，收支以實際交易為準。</p> : null}
          <div className="ls-scheduled-actions">
            {plan.state === "open" ? <><button disabled={controlsDisabled || !dataReady} onClick={() => { setLinking(plan); setPaymentId(""); setDraft(null); }}>連結已付交易</button><button disabled={controlsDisabled} onClick={() => receipt(plan, "skipped")}>本期略過</button></> : plan.active ? <button disabled={controlsDisabled} onClick={() => receipt(plan, "open")}>恢復本期預留</button> : null}
            <button disabled={controlsDisabled} onClick={() => { setDraft(planDraft(plan)); setLinking(null); }}>編輯 {plan.name}</button><button disabled={controlsDisabled} onClick={() => toggle(plan)}>{plan.active ? "暫停" : "恢復"}</button>
          </div>
        </article>)}</div>}
        {linking ? <form className="ls-scheduled-form" onSubmit={(event) => { event.preventDefault(); if (paymentId) receipt(linking, "linked", paymentId); }}><h3>連結「{linking.name}」的付款</h3><label>已記帳的付款<select aria-label="已記帳的付款" required value={paymentId} onChange={(event) => setPaymentId(event.target.value)}><option value="">選擇同月份、同幣別支出</option>{payments.map((tx) => <option key={tx.id} value={tx.id}>{ledgerDay(tx)} · {tx.merchant || "交易"} · {amountLabel(-(tx.amount_minor || 0), currency)}</option>)}</select></label><p>一筆交易只能連結一個預留。實際金額可不同；連結後整筆預留解除。如需分期付款，請拆成多個預留項目。</p><div className="ls-scheduled-actions"><button type="submit" className="ls-button ls-primary" disabled={controlsDisabled || !paymentId}>確認連結付款</button><button type="button" className="ls-button ls-secondary" disabled={saving} onClick={() => setLinking(null)}>取消</button></div></form> : null}
        {draft ? <form className="ls-scheduled-form" onSubmit={(event) => { event.preventDefault(); save(); }}><h3>{draft.version ? "編輯預留項目" : "新增預留項目"}</h3><div className="ls-scheduled-fields">
          <label>項目名稱<input aria-label="預留項目名稱" maxLength={80} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：房租、訂閱、旅費" /></label>
          <label>預留金額（{currency}）<input aria-label="預留金額" inputMode="decimal" required value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
          <label>重複方式<select aria-label="重複方式" value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as Draft["recurrence"] })}><option value="monthly">每月</option><option value="once">單次</option></select></label>
          <label>開始月份<input aria-label="預留開始月份" type="month" min="2000-01" max="2099-12" required value={draft.start_month} onChange={(event) => setDraft({ ...draft, start_month: event.target.value })} /></label>
          <label>預計付款日<input aria-label="預計付款日" type="number" min={1} max={31} required value={draft.due_day} onChange={(event) => setDraft({ ...draft, due_day: Number(event.target.value) })} /></label>
          {draft.recurrence === "monthly" ? <label>結束月份（選填）<input aria-label="預留結束月份" type="month" min={draft.start_month} max="2099-12" value={draft.end_month} onChange={(event) => setDraft({ ...draft, end_month: event.target.value })} /></label> : null}
          <label>預計付款帳戶<select aria-label="預計付款帳戶" value={draft.account_id} onChange={(event) => setDraft({ ...draft, account_id: event.target.value })}><option value="">未指定</option>{accounts.filter((a) => a.currency?.trim() === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>預留分類<select aria-label="預留分類" value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}><option value="">未分類</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div><p>沒有該日期的月份會用月底，例如每月 31 日在 2 月使用 28／29 日。修改計畫會重新計算各月份預留，但不會改動已記帳的交易。</p><div className="ls-scheduled-actions"><button className="ls-button ls-primary" type="submit" disabled={controlsDisabled}>儲存預留項目</button><button className="ls-button ls-secondary" type="button" disabled={saving} onClick={() => setDraft(null)}>取消</button></div></form> : <button type="button" className="ls-button ls-secondary" disabled={controlsDisabled} onClick={startNew}>新增預留項目</button>}
      </> : null}
      {notice ? <p className="ls-scheduled-notice" role="status">{notice}</p> : null}
    </section>
  </div>;
}
