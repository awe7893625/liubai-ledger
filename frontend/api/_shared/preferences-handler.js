import { adminClient, bodyOf, handleError, httpError, requireUser, send } from "./cloud.js";
import { budgetCurrency, budgetVersion } from "./budget-handler.js";

export const PREFERENCE_FIELDS = "display_name,theme,home_currency,default_account_id,default_category_id,version,updated_at";
export const DEFAULT_PREFERENCES = Object.freeze({ display_name: "", theme: "system", home_currency: "TWD", default_account_id: null, default_category_id: null, version: 0, updated_at: null });

export async function ownedOptional(db, table, owner, id) {
  if (id == null || id === "") return null;
  if (typeof id !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw httpError(400, "無效的選項識別碼");
  const { data, error } = await db.from(table).select(table === "ledger_accounts" ? "id,currency" : "id").eq("id", id).eq("user_id", owner).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(400, "選項不屬於目前帳號，請重新載入");
  return data;
}
export async function readPreferences(db, userId) {
  const { data, error } = await db.from("ledger_preferences").select(PREFERENCE_FIELDS).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data || { ...DEFAULT_PREFERENCES };
}
export default async function preferencesHandler(req, res) {
  if (!["GET", "PUT"].includes(req.method)) { res.setHeader("Allow", "GET, PUT"); return send(res, 405, { ok: false, error: "Method not allowed" }); }
  try {
    const user = await requireUser(req); const db = adminClient();
    if (req.method === "GET") return send(res, 200, { ok: true, preferences: await readPreferences(db, user.id) });
    const body = bodyOf(req); const version = budgetVersion(body.version);
    if (typeof body.display_name !== "string" || body.display_name.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(body.display_name)) throw httpError(400, "暱稱最多 40 個字，不可包含控制字元");
    if (!["system", "light", "dark"].includes(body.theme)) throw httpError(400, "無效的顯示模式");
    const currency = budgetCurrency(body.home_currency);
    const account = await ownedOptional(db, "ledger_accounts", user.id, body.default_account_id);
    const category = await ownedOptional(db, "ledger_categories", user.id, body.default_category_id);
    const values = { user_id: user.id, display_name: body.display_name.trim(), theme: body.theme, home_currency: currency,
      default_account_id: account?.id || null, default_category_id: category?.id || null, version: version + 1, updated_at: new Date().toISOString() };
    const result = version === 0
      ? await db.from("ledger_preferences").insert(values).select(PREFERENCE_FIELDS).maybeSingle()
      : await db.from("ledger_preferences").update(values).eq("user_id", user.id).eq("version", version).select(PREFERENCE_FIELDS).maybeSingle();
    if (result.error?.code === "23505" || (!result.error && !result.data)) throw httpError(409, "設定已被另一台裝置更新，請重新載入再修改");
    if (result.error) throw result.error;
    return send(res, version === 0 ? 201 : 200, { ok: true, preferences: result.data });
  } catch (error) { return handleError(res, error); }
}
