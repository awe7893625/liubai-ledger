import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { budgetUsage } from "./budget-data";
import type { MonthlyBudget } from "./budget-data";
import type { LedgerRow } from "./ledger-data";
import "./budget-panel.css";

type Props = { session: Session; month: string; currency: string; transactions: LedgerRow[]; categories: { id: string; name: string }[]; dataReady: boolean; scheduledOutstanding?: number; scheduledReady?: boolean };
const money = (value: number, currency: string) => `${value < 0 ? "−" : ""}${currency === "TWD" ? "NT$" : currency + " "}${(Math.abs(value) / 100).toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`;
const major = (minor: number) => (minor / 100).toFixed(2).replace(/\.00$/, "");

export function BudgetPanel({ session, month, currency, transactions, categories, dataReady, scheduledOutstanding = 0, scheduledReady = true }: Props) {
  const [budget, setBudget] = useState<MonthlyBudget | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [total, setTotal] = useState("");
  const [buffer, setBuffer] = useState("0");
  const [limits, setLimits] = useState<Record<string, string>>({});
  const alive = useRef(true);
  const busy = useRef(false);
  const generation = useRef(0);
  const usage = useMemo(() => budgetUsage(transactions, month, currency, budget), [transactions, month, currency, budget]);
  const availableAfterPlans = (usage.available ?? 0) - scheduledOutstanding;
  const planningReady = dataReady && scheduledReady;
  const request = useCallback(async (method: string, body?: object) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const query = new URLSearchParams({ month, currency });
      const response = await fetch(`/api/v2/budgets?${query}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "無法確認預算，請重新整理後檢查。");
      return result as { ok: boolean; budget: MonthlyBudget | null };
    } catch (failure) {
      if (controller.signal.aborted) throw new Error("連線逾時，結果尚未確認。請重新載入，避免覆蓋其他裝置的修改。");
      throw failure;
    } finally { window.clearTimeout(timer); }
  }, [month, currency, session.access_token]);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await request("GET");
      if (!alive.current || ticket !== generation.current) return;
      setBudget(result.budget); setEditing(false);
    } catch (failure) {
      if (alive.current && ticket === generation.current) setError(failure instanceof Error ? failure.message : "預算載入失敗");
    } finally { if (alive.current && ticket === generation.current) setLoading(false); }
  }, [request]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const begin = () => {
    setTotal(budget ? major(budget.total_limit_minor) : "");
    setBuffer(budget ? major(budget.safety_buffer_minor) : "0");
    setLimits(Object.fromEntries(Object.entries(budget?.category_limits || {}).map(([id, value]) => [id, major(value)])));
    setEditing(true); setNotice("");
  };
  const save = async () => {
    if (busy.current || loading) return;
    const values = [total, buffer, ...Object.values(limits).filter((v) => v.trim())];
    if (values.some((v) => !/^\d+(?:\.\d{1,2})?$/.test(v.trim()))) { setNotice("請填非負金額，最多兩位小數。"); return; }
    busy.current = true; setSaving(true); setNotice("");
    try {
      const category_limits = Object.fromEntries(Object.entries(limits).filter(([, value]) => value.trim()));
      const result = await request("PUT", { month, currency, version: budget?.version || 0, total_limit: total, safety_buffer: buffer, category_limits });
      if (!result.budget) throw new Error("未收到儲存確認，請重新載入。");
      if (alive.current) { setBudget(result.budget); setEditing(false); setError(""); setNotice("預算已儲存到雲端，其他裝置重新載入即可看到。"); }
    } catch (failure) { if (alive.current) setNotice(failure instanceof Error ? failure.message : "儲存失敗"); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const remove = async () => {
    if (!budget || busy.current || !window.confirm(`刪除 ${month} ${currency} 的預算設定？交易不會刪除。`)) return;
    busy.current = true; setSaving(true); setNotice("");
    try {
      await request("DELETE", { month, currency, version: budget.version });
      if (alive.current) { setBudget(null); setEditing(false); setNotice("預算設定已刪除，交易保留。"); }
    } catch (failure) { if (alive.current) setNotice(failure instanceof Error ? failure.message : "刪除失敗"); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };

  return <section className="ls-budget" aria-label="月預算管理" data-month={month}>
    <header><div><p>{month} · {currency}</p><h2>月預算</h2></div><button type="button" className="ls-button ls-secondary" disabled={loading || saving} onClick={() => void load()}>重新載入預算</button></header>
    {loading ? <p role="status">正在載入雲端預算…</p> : error ? <p role="alert">{error}</p> : <>
      {!budget ? <div className="ls-budget-empty"><p>這個月份尚未設定預算。可分幣別設定總額、分類額度和安全保留金額。</p>{!editing ? <button className="ls-button ls-primary" onClick={begin}>設定月預算</button> : null}</div> : <>
        <div className="ls-budget-stats"><div><span>月預算</span><strong>{money(budget.total_limit_minor, currency)}</strong></div><div><span>{usage.overBudget ? "超出預算" : "預算餘額"}</span><strong data-warning={usage.overBudget}>{dataReady ? money(Math.abs(usage.remaining || 0), currency) : "—"}</strong></div><div><span>扣除安全金與待付預留後</span><strong>{planningReady ? money(availableAfterPlans, currency) : "—"}</strong></div></div>
        {dataReady ? <><progress aria-label="預算使用率" max={Math.max(1, budget.total_limit_minor)} value={Math.min(usage.netSpent, Math.max(1, budget.total_limit_minor))} /><p className="ls-budget-caption">已用 {money(usage.netSpent, currency)}，退款沖減支出；轉帳、待確認及其他幣別不計。{planningReady ? ` 待付預留 ${money(scheduledOutstanding, currency)}。` : " 預留清單尚未確認，暫不計可自由使用額。"}{usage.dailyAvailable !== null && planningReady ? ` 本月剩餘 ${usage.daysRemaining} 天，日均可用 ${money(Math.floor(Math.max(0, availableAfterPlans) / usage.daysRemaining), currency)}。` : usage.dailyAvailable === null ? " 此月份已結束。" : ""}</p></> : <p>帳本尚未完整載入，暫不計算餘額。</p>}
        {!editing ? <div className="ls-budget-actions"><button className="ls-button ls-secondary" onClick={begin}>編輯預算</button><button className="ls-budget-remove" disabled={saving} onClick={() => void remove()}>刪除此月設定</button></div> : null}
        {Object.keys(budget.category_limits).length > 0 && !editing ? <div className="ls-budget-categories">{categories.filter((category) => Object.prototype.hasOwnProperty.call(budget.category_limits, category.id)).map((category) => <div key={category.id}><span>{category.name}</span><strong data-warning={dataReady && (usage.categorySpent[category.id] || 0) > budget.category_limits[category.id]}>{dataReady ? money(usage.categorySpent[category.id] || 0, currency) : "—"} / {money(budget.category_limits[category.id], currency)}</strong></div>)}</div> : null}
      </>}
      {editing ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}><div className="ls-budget-fields"><label>月預算金額<input aria-label="月預算金額" inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="例如 30000" required /></label><label>安全保留金額<input aria-label="安全保留金額" inputMode="decimal" value={buffer} onChange={(event) => setBuffer(event.target.value)} required /></label></div><details><summary>分類預算（選填）</summary><p>留白表示不設上限；分類額度合計不能超過月預算。</p><div className="ls-budget-fields">{categories.map((category) => <label key={category.id}>{category.name}<input aria-label={`分類預算 ${category.name}`} inputMode="decimal" placeholder="不設上限" value={limits[category.id] || ""} onChange={(event) => setLimits((previous) => ({ ...previous, [category.id]: event.target.value }))} /></label>)}</div></details><div className="ls-budget-actions"><button className="ls-button ls-primary" type="submit" disabled={saving}>{saving ? "儲存中…" : "儲存預算"}</button><button className="ls-button ls-secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>取消</button></div></form> : null}
    </>}
    {notice ? <p className="ls-budget-notice" role="status">{notice}</p> : null}
  </section>;
}
