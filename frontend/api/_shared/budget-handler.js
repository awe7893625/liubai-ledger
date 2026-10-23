import { adminClient, bodyOf, handleError, httpError, requireUser, send } from "./cloud.js";

const FIELDS = "period_month,currency,total_limit_minor,safety_buffer_minor,category_limits,version,updated_at";
const MAX_MINOR = 9_000_000_000_000;

export function budgetPeriod(value) {
  if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)) throw httpError(400, "月份需為 YYYY-MM（2000–2099）");
  return value;
}
export function budgetCurrency(value) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw httpError(400, "Invalid currency");
  return value;
}
export function budgetMoney(value) {
  if (typeof value !== "number" && typeof value !== "string") throw httpError(400, "預算需為有效金額");
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw httpError(400, "預算需為非負數，最多兩位小數");
  const [whole, fraction = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) throw httpError(400, "預算金額超出範圍");
  return minor;
}
export function budgetVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw httpError(400, "缺少有效版本，請重新載入預算");
  return value;
}

export default async function budgetHandler(req, res) {
  if (!["GET", "PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const body = bodyOf(req);
    const params = req.method === "GET" ? req.query || {} : body;
    const month = budgetPeriod(params.month);
    const currency = budgetCurrency(params.currency || "TWD");
    const owned = () => db.from("ledger_budgets").select(FIELDS)
      .eq("user_id", user.id).eq("period_month", month).eq("currency", currency);
    if (req.method === "GET") {
      const { data, error } = await owned().maybeSingle();
      if (error) throw error;
      return send(res, 200, { ok: true, budget: data || null });
    }
    const version = budgetVersion(body.version);
    if (req.method === "DELETE") {
      if (version < 1) throw httpError(400, "尚未設定預算");
      const { data, error } = await db.from("ledger_budgets").delete()
        .eq("user_id", user.id).eq("period_month", month).eq("currency", currency).eq("version", version)
        .select("period_month").maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(409, "預算已被其他裝置更新或刪除，請重新載入");
      return send(res, 200, { ok: true });
    }
    const total = budgetMoney(body.total_limit);
    const buffer = budgetMoney(body.safety_buffer ?? 0);
    if (buffer > total) throw httpError(400, "安全保留金額不可超過月預算");
    const rawLimits = body.category_limits ?? {};
    if (!rawLimits || typeof rawLimits !== "object" || Array.isArray(rawLimits) || Object.keys(rawLimits).length > 100) {
      throw httpError(400, "分類預算格式不正確");
    }
    const { data: categories, error: categoryError } = await db.from("ledger_categories").select("id").eq("user_id", user.id);
    if (categoryError) throw categoryError;
    const allowed = new Set((categories || []).map((row) => row.id));
    const limits = {};
    for (const [id, value] of Object.entries(rawLimits)) {
      if (!allowed.has(id)) throw httpError(400, "Unknown category");
      limits[id] = budgetMoney(value);
    }
    if (Object.values(limits).reduce((sum, amount) => sum + amount, 0) > total) {
      throw httpError(400, "分類預算合計不可超過月預算");
    }
    const values = { user_id: user.id, period_month: month, currency,
      total_limit_minor: total, safety_buffer_minor: buffer, category_limits: limits,
      version: version + 1, updated_at: new Date().toISOString() };
    let result;
    if (version === 0) result = await db.from("ledger_budgets").insert(values).select(FIELDS).maybeSingle();
    else result = await db.from("ledger_budgets").update(values)
      .eq("user_id", user.id).eq("period_month", month).eq("currency", currency).eq("version", version)
      .select(FIELDS).maybeSingle();
    if (result.error?.code === "23505" || (!result.error && !result.data)) {
      throw httpError(409, "預算已被其他裝置更新，請重新載入後再儲存");
    }
    if (result.error) throw result.error;
    return send(res, version ? 200 : 201, { ok: true, budget: result.data });
  } catch (error) { return handleError(res, error); }
}
