import {
  adminClient,
  bodyOf,
  handleError,
  httpError,
  normalizeAmount,
  normalizedMerchant,
  randomToken,
  requireUser,
  safeCurrency,
  send,
} from "../_shared/cloud.js";

function cleanText(value, max = 240) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, max) : null;
}

function safeOccurredAt(value) {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw httpError(400, "Invalid occurred_at");
  return new Date(parsed).toISOString();
}

async function ownedReference(db, table, userId, id) {
  if (!id) return null;
  const { data, error } = await db
    .from(table)
    .select("id,name")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(400, `Unknown ${table === "ledger_accounts" ? "account" : "category"}`);
  return data;
}

async function findTransaction(db, userId, id) {
  const { data, error } = await db
    .from("ledger_transactions")
    .select("id,user_id,request_id,source,amount_minor,currency,occurred_at,merchant,card_label,status,account_id,category_id,note,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const body = bodyOf(req);

    if (req.method === "POST") {
      const amount = normalizeAmount(body.amount);
      if (amount === null || amount === 0) throw httpError(400, "amount must be a non-zero number");

      const merchant = normalizedMerchant(body.merchant);
      if (!merchant) throw httpError(400, "merchant required");

      const account = await ownedReference(db, "ledger_accounts", user.id, cleanText(body.account_id, 80));
      const category = await ownedReference(db, "ledger_categories", user.id, cleanText(body.category_id, 80));
      const direction = body.direction === "income" ? "income" : "expense";
      const signedAmount = direction === "income" ? Math.abs(amount) : -Math.abs(amount);
      const requestId = cleanText(body.request_id, 160) || `manual_${randomToken(18)}`;

      const values = {
        user_id: user.id,
        device_id: null,
        request_id: requestId,
        source: "manual",
        amount_minor: signedAmount,
        currency: safeCurrency(body.currency),
        occurred_at: safeOccurredAt(body.occurred_at),
        merchant,
        merchant_normalized: merchant.toLocaleLowerCase("zh-TW"),
        card_label: account?.name || cleanText(body.card, 120),
        account_id: account?.id || null,
        category_id: category?.id || null,
        note: cleanText(body.note, 1000),
        status: "confirmed",
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await db
        .from("ledger_transactions")
        .insert(values)
        .select("id,request_id,source,amount_minor,currency,occurred_at,merchant,card_label,status,account_id,category_id,note,created_at,updated_at")
        .maybeSingle();

      if (error?.code === "23505") {
        const { data: existing, error: existingError } = await db
          .from("ledger_transactions")
          .select("id,request_id,source,amount_minor,currency,occurred_at,merchant,card_label,status,account_id,category_id,note,created_at,updated_at")
          .eq("user_id", user.id)
          .eq("request_id", requestId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (!existing) throw httpError(503, "Transaction retry required");
        return send(res, 200, { ok: true, duplicate: true, transaction: existing });
      }
      if (error) throw error;
      if (!data) throw httpError(503, "Transaction not confirmed");
      return send(res, 201, { ok: true, duplicate: false, transaction: data });
    }

    if (req.method === "PATCH") {
      const id = cleanText(body.id, 80);
      if (!id) throw httpError(400, "id required");
      const current = await findTransaction(db, user.id, id);
      if (!current) throw httpError(404, "Transaction not found");

      const patch = { updated_at: new Date().toISOString() };
      if (body.merchant !== undefined) {
        const merchant = normalizedMerchant(body.merchant);
        if (!merchant) throw httpError(400, "merchant required");
        patch.merchant = merchant;
        patch.merchant_normalized = merchant.toLocaleLowerCase("zh-TW");
      }
      if (body.amount !== undefined) {
        const amount = normalizeAmount(body.amount);
        if (amount === null || amount === 0) throw httpError(400, "amount must be a non-zero number");
        const income = body.direction === "income" || (body.direction === undefined && current.amount_minor > 0);
        patch.amount_minor = income ? Math.abs(amount) : -Math.abs(amount);
      }
      if (body.occurred_at !== undefined) patch.occurred_at = safeOccurredAt(body.occurred_at);
      if (body.note !== undefined) patch.note = cleanText(body.note, 1000);
      if (body.card !== undefined) patch.card_label = cleanText(body.card, 120);
      if (body.account_id !== undefined) {
        const account = await ownedReference(db, "ledger_accounts", user.id, cleanText(body.account_id, 80));
        patch.account_id = account?.id || null;
        if (account) patch.card_label = account.name;
      }
      if (body.category_id !== undefined) {
        const category = await ownedReference(db, "ledger_categories", user.id, cleanText(body.category_id, 80));
        patch.category_id = category?.id || null;
      }

      const { data, error } = await db
        .from("ledger_transactions")
        .update(patch)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id,request_id,source,amount_minor,currency,occurred_at,merchant,card_label,status,account_id,category_id,note,created_at,updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(404, "Transaction not found");
      return send(res, 200, { ok: true, transaction: data });
    }

    if (req.method === "DELETE") {
      const id = cleanText(body.id, 80);
      if (!id) throw httpError(400, "id required");
      const { data, error } = await db
        .from("ledger_transactions")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw httpError(404, "Transaction not found");
      return send(res, 200, { ok: true, id: data.id });
    }

    res.setHeader("Allow", "POST, PATCH, DELETE");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    return handleError(res, error);
  }
}
