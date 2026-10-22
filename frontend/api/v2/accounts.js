import { adminClient, bodyOf, handleError, httpError, requireUser, send } from "../_shared/cloud.js";
import { ACCOUNT_FIELDS, accountInput, checkAccountCollision, ownedConfig } from "../_shared/account-config.js";

export default async function handler(req, res) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const config = await ownedConfig(db, user.id);
    if (req.method === "GET") return send(res, 200, { ok: true, ...config });
    const body = bodyOf(req);
    const id = typeof body.id === "string" ? body.id : null;
    if (req.method !== "POST" && !config.accounts.some((a) => a.id === id)) throw httpError(404, "找不到這個付款方式");
    if (req.method === "DELETE") {
      if (config.accounts.length < 2) throw httpError(409, "請至少保留一個付款方式");
      const { count, error: countError } = await db.from("ledger_transactions")
        .select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("account_id", id);
      if (countError) throw countError;
      if (count) throw httpError(409, "此付款方式已有交易，請改名或調整別名，不要刪除歷史帳戶");
      const { data, error } = await db.from("ledger_accounts").delete().eq("user_id", user.id).eq("id", id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(404, "找不到這個付款方式");
      return send(res, 200, { ok: true, id: data.id });
    }
    if (req.method === "POST" && config.accounts.length >= 50) throw httpError(409, "每個帳號最多 50 個付款方式");
    const values = accountInput(body);
    checkAccountCollision(values, config.accounts, req.method === "PATCH" ? id : null);
    let query = req.method === "POST"
      ? db.from("ledger_accounts").insert({ ...values, user_id: user.id })
      : db.from("ledger_accounts").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    const { data, error } = await query.select(ACCOUNT_FIELDS).maybeSingle();
    if (error?.code === "23505") throw httpError(409, "付款方式名稱已存在");
    if (error) throw error;
    if (!data) throw httpError(404, "找不到這個付款方式");
    return send(res, req.method === "POST" ? 201 : 200, { ok: true, account: data });
  } catch (error) {
    return handleError(res, error);
  }
}
