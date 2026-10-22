import {
  adminClient, bodyOf, handleError, httpError, normalizeAmount, normalizedMerchant,
  randomToken, requireUser, safeCurrency, send,
} from "../_shared/cloud.js";

const FIELDS = "id,request_id,source,amount_minor,currency,occurred_at,merchant,card_label,status,account_id,category_id,note,created_at,updated_at,legacy_date,legacy_kind";
function cleanText(value, max = 240) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}
function validCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw httpError(400, "Invalid date");
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw httpError(400, "Invalid date");
  return value;
}
function safeOccurredAt(value) {
  if (!value) return new Date().toISOString();
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw httpError(400, "Invalid occurred_at");
  return new Date(value).toISOString();
}
async function ownedReference(db, table, userId, id) {
  if (!id) return null;
  const { data, error } = await db.from(table).select(table === "ledger_accounts" ? "id,name,currency" : "id,name")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(400, `Unknown ${table === "ledger_accounts" ? "account" : "category"}`);
  return data;
}
function amountOf(value) {
  const amount = normalizeAmount(value);
  if (amount === null || amount === 0 || !Number.isSafeInteger(amount)) throw httpError(400, "amount must be a non-zero safe number");
  return amount;
}
function directionOf(value, fallback = "expense") {
  const direction = value ?? fallback;
  if (!["income", "expense"].includes(direction)) throw httpError(400, "Invalid direction");
  return direction;
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const body = bodyOf(req);
    if (req.method === "POST") {
      const amount = amountOf(body.amount);
      const merchant = normalizedMerchant(body.merchant);
      if (!merchant) throw httpError(400, "merchant required");
      const account = await ownedReference(db, "ledger_accounts", user.id, cleanText(body.account_id, 80));
      const category = await ownedReference(db, "ledger_categories", user.id, cleanText(body.category_id, 80));
      const direction = directionOf(body.direction);
      const currency = safeCurrency(body.currency);
      if (account?.currency && account.currency.trim() !== currency) throw httpError(400, "帳戶幣別與交易不符");
      const requestId = cleanText(body.request_id, 160) || `manual_${randomToken(18)}`;
      const values = { user_id: user.id, device_id: null, request_id: requestId, source: "manual",
        amount_minor: direction === "income" ? Math.abs(amount) : -Math.abs(amount), currency,
        occurred_at: safeOccurredAt(body.occurred_at), merchant,
        merchant_normalized: merchant.toLocaleLowerCase("zh-TW"), card_label: account?.name || cleanText(body.card, 120),
        account_id: account?.id || null, category_id: category?.id || null,
        note: cleanText(body.note, 1000), status: "confirmed", updated_at: new Date().toISOString() };
      const { data, error } = await db.from("ledger_transactions").insert(values).select(FIELDS).maybeSingle();
      if (error?.code === "23505") {
        const existing = await db.from("ledger_transactions").select(FIELDS).eq("user_id", user.id).eq("request_id", requestId).maybeSingle();
        if (existing.error) throw existing.error;
        if (!existing.data) throw httpError(503, "Transaction retry required");
        return send(res, 200, { ok: true, duplicate: true, transaction: existing.data });
      }
      if (error) throw error;
      if (!data) throw httpError(503, "Transaction not confirmed");
      return send(res, 201, { ok: true, duplicate: false, transaction: data });
    }
    if (req.method === "PATCH") {
      const id = cleanText(body.id, 80);
      if (!id) throw httpError(400, "id required");
      const currentResult = await db.from("ledger_transactions").select(FIELDS).eq("id", id).eq("user_id", user.id).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      const current = currentResult.data;
      if (!current) throw httpError(404, "Transaction not found");
      if (body.expected_updated_at && body.expected_updated_at !== current.updated_at) throw httpError(409, "交易已被更新，請重新載入後再編輯");
      const patch = { updated_at: new Date().toISOString() };
      if (body.merchant !== undefined) {
        const merchant = normalizedMerchant(body.merchant);
        if (!merchant) throw httpError(400, "merchant required");
        patch.merchant = merchant; patch.merchant_normalized = merchant.toLocaleLowerCase("zh-TW");
      }
      if (body.amount !== undefined) {
        const amount = amountOf(body.amount);
        const direction = directionOf(body.direction, current.amount_minor > 0 ? "income" : "expense");
        patch.amount_minor = direction === "income" ? Math.abs(amount) : -Math.abs(amount);
      }
      if (body.date !== undefined) {
        if (!current.legacy_date) throw httpError(400, "Use occurred_at for timestamped transactions");
        patch.legacy_date = validCalendarDate(body.date);
        patch.occurred_at = new Date(patch.legacy_date + "T12:00:00+08:00").toISOString();
      } else if (body.occurred_at !== undefined) {
        if (current.legacy_date) throw httpError(400, "歷史交易請修改日期，不使用匯入時間");
        patch.occurred_at = safeOccurredAt(body.occurred_at);
      }
      if (body.note !== undefined) patch.note = cleanText(body.note, 1000);
      if (body.card !== undefined) patch.card_label = cleanText(body.card, 120);
      if (body.account_id !== undefined) {
        const account = await ownedReference(db, "ledger_accounts", user.id, cleanText(body.account_id, 80));
        if (account?.currency && account.currency.trim() !== current.currency.trim()) throw httpError(400, "不可把交易移到不同幣別的帳戶");
        patch.account_id = account?.id || null; patch.card_label = account?.name || null;
      }
      if (body.category_id !== undefined) {
        const category = await ownedReference(db, "ledger_categories", user.id, cleanText(body.category_id, 80));
        patch.category_id = category?.id || null;
      }
      if (body.status !== undefined) {
        if (!["pending", "confirmed"].includes(body.status)) throw httpError(400, "Invalid status");
        if (body.status === "confirmed" && (!(patch.merchant ?? current.merchant) || (patch.amount_minor ?? current.amount_minor) == null)) throw httpError(400, "金額與商家完整後才能確認");
        patch.status = body.status;
      }
      let query = db.from("ledger_transactions").update(patch).eq("id", id).eq("user_id", user.id);
      if (body.expected_updated_at) query = query.eq("updated_at", body.expected_updated_at);
      const { data, error } = await query.select(FIELDS).maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(409, "交易已變更，請重新載入");
      return send(res, 200, { ok: true, transaction: data });
    }
    if (req.method === "DELETE") {
      const id = cleanText(body.id, 80);
      if (!id) throw httpError(400, "id required");
      const { data, error } = await db.from("ledger_transactions").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(404, "Transaction not found");
      return send(res, 200, { ok: true, id: data.id });
    }
    res.setHeader("Allow", "POST, PATCH, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) { return handleError(res, error); }
}
