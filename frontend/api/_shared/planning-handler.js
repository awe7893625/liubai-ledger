import { adminClient, bodyOf, handleError, httpError, requireUser, send } from "./cloud.js";
import { budgetPeriod, budgetCurrency, budgetMoney, budgetVersion } from "./budget-handler.js";
import { ownedOptional } from "./preferences-handler.js";

const FIELDS = "id,name,amount_minor,currency,recurrence,start_month,end_month,due_day,account_id,category_id,active,version,updated_at";
const RECEIPTS = "plan_id,period_month,status,transaction_id,version";
const uuid = (value) => {
  if (typeof value !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) throw httpError(400, "無效的項目識別碼");
  return value;
};
export function planApplies(plan, month) {
  return plan.start_month <= month && (!plan.end_month || month <= plan.end_month) && (plan.recurrence === "monthly" || month === plan.start_month);
}
export function planDueDate(month, day) {
  const [year, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
function transactionMonth(tx) {
  if (tx.legacy_date) return tx.legacy_date.slice(0, 7);
  const date = new Date(tx.occurred_at);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}
export function validPayment(tx, month, currency) {
  return Boolean(tx && tx.status === "confirmed" && Number.isSafeInteger(tx.amount_minor) && tx.amount_minor < 0
    && !["transfer", "refund"].includes(tx.legacy_kind) && tx.currency.trim() === currency && transactionMonth(tx) === month);
}
export function projectPlan(plan, month, receipt, tx) {
  const linked = receipt?.status === "linked" && validPayment(tx, month, plan.currency.trim());
  const state = !plan.active ? "paused" : linked ? "paid" : receipt?.status === "skipped" ? "skipped" : "open";
  return { ...plan, due_date: planDueDate(month, plan.due_day), state,
    outstanding_minor: state === "open" ? plan.amount_minor : 0,
    receipt_version: receipt?.version || 0, linked_transaction_id: linked ? tx.id : null,
    linked_amount_minor: linked ? -tx.amount_minor : null,
    payment_needs_review: plan.active && receipt?.status === "linked" && !linked };
}
async function getPlan(db, owner, id) {
  const { data, error } = await db.from("ledger_scheduled_expenses").select(FIELDS).eq("user_id", owner).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "找不到預留項目");
  return data;
}
async function planValues(db, owner, body) {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name)) throw httpError(400, "請填 1–80 字的項目名稱");
  const amount = budgetMoney(body.amount);
  if (amount <= 0) throw httpError(400, "預留金額必須大於零");
  if (!["once", "monthly"].includes(body.recurrence)) throw httpError(400, "無效的重複方式");
  const start = budgetPeriod(body.start_month); const end = body.end_month ? budgetPeriod(body.end_month) : null;
  if (end && (end < start || body.recurrence === "once")) throw httpError(400, "結束月份不正確");
  if (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 31) throw httpError(400, "日期需為 1–31 日");
  if (body.active !== undefined && typeof body.active !== "boolean") throw httpError(400, "無效的啟用狀態");
  const currency = budgetCurrency(body.currency);
  const account = await ownedOptional(db, "ledger_accounts", owner, body.account_id);
  const category = await ownedOptional(db, "ledger_categories", owner, body.category_id);
  if (account && account.currency.trim() !== currency) throw httpError(400, "付款帳戶與預留幣別不同");
  return { name: body.name.trim(), amount_minor: amount, currency, recurrence: body.recurrence, start_month: start, end_month: end,
    due_day: body.due_day, account_id: account?.id || null, category_id: category?.id || null, active: body.active ?? true };
}

export default async function planningHandler(req, res) {
  if (!["GET", "POST", "PUT", "PATCH"].includes(req.method)) { res.setHeader("Allow", "GET, POST, PUT, PATCH"); return send(res, 405, { ok: false, error: "Method not allowed" }); }
  try {
    const user = await requireUser(req); const db = adminClient(); const body = bodyOf(req);
    if (req.method === "GET") {
      const month = budgetPeriod(req.query?.month); const currency = budgetCurrency(req.query?.currency || "TWD");
      const [plans, receipts] = await Promise.all([
        db.from("ledger_scheduled_expenses").select(FIELDS).eq("user_id", user.id).eq("currency", currency).order("created_at", { ascending: true }).limit(501),
        db.from("ledger_scheduled_receipts").select(RECEIPTS).eq("user_id", user.id).eq("period_month", month).limit(501),
      ]);
      if (plans.error) throw plans.error;
      if (receipts.error) throw receipts.error;
      if (plans.data.length > 500 || receipts.data.length > 500) throw httpError(422, "預留項目超過本版支援範圍，無法顯示完整總額");
      const receiptMap = new Map(receipts.data.map((r) => [r.plan_id, r]));
      const ids = receipts.data.map((r) => r.transaction_id).filter(Boolean);
      let txs = [];
      if (ids.length) {
        const result = await db.from("ledger_transactions").select("id,amount_minor,currency,status,occurred_at,legacy_date,legacy_kind").eq("user_id", user.id).in("id", ids);
        if (result.error) throw result.error;
        txs = result.data;
      }
      const txMap = new Map(txs.map((tx) => [tx.id, tx]));
      const items = plans.data.filter((plan) => planApplies(plan, month)).map((plan) => {
        const receipt = receiptMap.get(plan.id); return projectPlan(plan, month, receipt, txMap.get(receipt?.transaction_id));
      }).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name));
      return send(res, 200, { ok: true, month, currency, items, outstanding_minor: items.reduce((sum, p) => sum + p.outstanding_minor, 0) });
    }
    if (req.method === "POST" || req.method === "PUT") {
      const id = uuid(body.id); const values = await planValues(db, user.id, body);
      const version = req.method === "POST" ? 0 : budgetVersion(body.version);
      if (req.method === "PUT" && version < 1) throw httpError(400, "請重新載入項目");
      const record = { ...values, user_id: user.id, id, version: version + 1, updated_at: new Date().toISOString() };
      let result;
      if (req.method === "POST") {
        const count = await db.from("ledger_scheduled_expenses").select("id", { count: "exact", head: true }).eq("user_id", user.id);
        if (count.error) throw count.error;
        if (count.count >= 500) throw httpError(422, "最多可設定 500 個預留項目");
        result = await db.from("ledger_scheduled_expenses").insert(record).select(FIELDS).maybeSingle();
        if (result.error?.code === "23505") {
          const existing = await getPlan(db, user.id, id);
          if (Object.entries(values).every(([key, value]) => existing[key] === value)) return send(res, 200, { ok: true, duplicate: true, plan: existing });
        }
      } else result = await db.from("ledger_scheduled_expenses").update(record).eq("id", id).eq("user_id", user.id).eq("version", version).select(FIELDS).maybeSingle();
      if (result.error?.code === "23505" || (!result.error && !result.data)) throw httpError(409, "項目已被修改，請重新載入");
      if (result.error) throw result.error;
      return send(res, version ? 200 : 201, { ok: true, plan: result.data });
    }
    // A receipt only links an existing transaction or skips this month's plan.
    const plan = await getPlan(db, user.id, uuid(body.plan_id));
    const month = budgetPeriod(body.month); const version = budgetVersion(body.version);
    if (!plan.active || !planApplies(plan, month)) throw httpError(400, "此月份沒有啟用的預留項目");
    if (!["linked", "skipped", "open"].includes(body.status)) throw httpError(400, "無效的本期狀態");
    let transactionId = null;
    if (body.status === "linked") {
      const id = uuid(body.transaction_id);
      const result = await db.from("ledger_transactions").select("id,amount_minor,currency,status,occurred_at,legacy_date,legacy_kind").eq("user_id", user.id).eq("id", id).maybeSingle();
      if (result.error) throw result.error;
      if (!validPayment(result.data, month, plan.currency.trim())) throw httpError(400, "請選擇同月份、同幣別且已確認的支出；轉帳與退款不能作為付款");
      transactionId = id;
    }
    const values = { user_id: user.id, plan_id: plan.id, period_month: month, status: body.status,
      transaction_id: transactionId, version: version + 1, updated_at: new Date().toISOString() };
    const result = version === 0
      ? await db.from("ledger_scheduled_receipts").insert(values).select(RECEIPTS).maybeSingle()
      : await db.from("ledger_scheduled_receipts").update(values).eq("user_id", user.id).eq("plan_id", plan.id).eq("period_month", month).eq("version", version).select(RECEIPTS).maybeSingle();
    if (result.error?.code === "23505" || (!result.error && !result.data)) throw httpError(409, "本期已更新，或這筆交易已連結其他預留項目，請重新載入");
    if (result.error) throw result.error;
    return send(res, 200, { ok: true, receipt: result.data });
  } catch (error) { return handleError(res, error); }
}
