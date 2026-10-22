import {
  adminClient,
  bodyOf,
  handleError,
  httpError,
  normalizeAmount,
  normalizedMerchant,
  safeCurrency,
  send,
  sha256Hex,
} from "../../_shared/cloud.js";

import { matchAccount, ownedConfig, requireDevice } from "../../_shared/account-config.js";

const EVENT_FIELDS = [
  "id",
  "user_id",
  "device_id",
  "request_id",
  "amount_minor",
  "currency",
  "merchant_raw",
  "card_raw",
  "occurred_at",
  "status",
  "transaction_id",
  "payload",
].join(",");

function retryableError(message) {
  return httpError(503, message);
}

async function findOwnedEvent(db, userId, requestId) {
  const { data, error } = await db
    .from("ledger_wallet_events")
    .select(EVENT_FIELDS)
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findOwnedTransaction(db, userId, requestId) {
  const { data, error } = await db
    .from("ledger_transactions")
    .select("id,status")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recoverOrInsertEvent(db, values, userId, requestId) {
  const { data: inserted, error } = await db
    .from("ledger_wallet_events")
    .insert(values)
    .select(EVENT_FIELDS)
    .maybeSingle();

  if (!error) {
    if (!inserted) throw retryableError("Wallet event not confirmed; retry request");
    return { event: inserted, created: true };
  }
  if (error.code !== "23505") throw error;

  let existing;
  try {
    existing = await findOwnedEvent(db, userId, requestId);
  } catch {
    throw retryableError("Wallet event not visible yet; retry request");
  }
  if (!existing) throw retryableError("Wallet event not visible yet; retry request");
  return { event: existing, created: false };
}

async function recoverOrInsertTransaction(db, values, userId, requestId) {
  let existing;
  try {
    existing = await findOwnedTransaction(db, userId, requestId);
  } catch {
    throw retryableError("Transaction not confirmed; retry request");
  }
  if (existing) return { transaction: existing, created: false };

  const { data: inserted, error } = await db
    .from("ledger_transactions")
    .insert(values)
    .select("id,status")
    .maybeSingle();
  if (!error) {
    if (!inserted) throw retryableError("Transaction not confirmed; retry request");
    return { transaction: inserted, created: true };
  }
  if (error.code !== "23505") throw retryableError("Transaction not confirmed; retry request");

  let winner;
  try {
    winner = await findOwnedTransaction(db, userId, requestId);
  } catch {
    throw retryableError("Transaction winner not visible yet; retry request");
  }
  if (!winner) throw retryableError("Transaction winner not visible yet; retry request");
  return { transaction: winner, created: false };
}

async function ensureEventLink(db, event, transaction) {
  const desiredStatus = transaction.status === "confirmed" ? "processed" : "needs_review";
  if (event.transaction_id && event.transaction_id !== transaction.id) {
    throw retryableError("Wallet event has a conflicting transaction link; retry request");
  }
  if (event.transaction_id === transaction.id && event.status === desiredStatus) return;

  let update = db
    .from("ledger_wallet_events")
    .update({ status: desiredStatus, transaction_id: transaction.id })
    .eq("id", event.id)
    .eq("user_id", event.user_id);
  update = event.transaction_id === transaction.id
    ? update.eq("transaction_id", transaction.id)
    : update.is("transaction_id", null);

  const { data: linked, error } = await update
    .select("id,transaction_id,status")
    .maybeSingle();
  if (error) throw retryableError("Wallet event link not confirmed; retry request");
  if (linked?.transaction_id === transaction.id && linked.status === desiredStatus) return;

  let current;
  try {
    current = await findOwnedEvent(db, event.user_id, event.request_id);
  } catch {
    throw retryableError("Wallet event link not confirmed; retry request");
  }
  if (current?.transaction_id === transaction.id && current.status === desiredStatus) return;
  throw retryableError("Wallet event link not confirmed; retry request");
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const db = adminClient();
    const device = await requireDevice(req, db);
    const config = await ownedConfig(db, device.user_id);
    // Narrow device capability: configuration labels only, never transactions/balances.
    if (req.method === "GET") {
      return send(res, 200, {
        ok: true, version: 2, message: "連線成功，尚未建立任何交易",
        accounts: Object.fromEntries(config.accounts.filter((a) => a.currency === "TWD").map((a) => [a.name, a.id])),
        categories: Object.fromEntries(config.categories.map((c) => [c.name, c.id])),
        currency: "TWD",
      });
    }
    const body = bodyOf(req);
    if (body.dry_run === true) return send(res, 200, { ok: true, dry_run: true, message: "連線成功，尚未建立任何交易" });
    const manual = body.source === "manual";
    if (body.source && !["manual", "apple_pay"].includes(body.source)) throw httpError(400, "Unsupported source");
    const direction = body.direction || "expense";
    if (!["expense", "income"].includes(direction)) throw httpError(400, "Unsupported direction");
    const explicitAccount = body.account_id ? config.accounts.find((a) => a.id === body.account_id) : null;
    if (body.account_id && !explicitAccount) throw httpError(400, "Unknown account");
    const category = body.category_id ? config.categories.find((c) => c.id === body.category_id) : null;
    if (body.category_id && !category) throw httpError(400, "Unknown category");
    const match = explicitAccount ? { account: explicitAccount, reason: "selected" } : matchAccount(body.card, config.accounts);
    if (manual && !explicitAccount) throw httpError(400, "手動記帳請選擇付款方式");
    const amountMinor = normalizeAmount(body.amount);
    const merchant = normalizedMerchant(body.merchant);
    const card = normalizedMerchant(body.card) || explicitAccount?.name || null;
    if (manual && (amountMinor === null || amountMinor <= 0 || !Number.isSafeInteger(amountMinor) || !merchant)) {
      throw httpError(400, "請填寫有效的正數金額與商家，並用支出／收入選項區分收支");
    }
    const occurredAt = body.occurred_at && !Number.isNaN(Date.parse(body.occurred_at))
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();
    const currency = safeCurrency(body.currency || explicitAccount?.currency);
    if (manual && currency !== "TWD") throw httpError(400, "手動捷徑目前以 TWD 記帳");
    if (explicitAccount && currency !== explicitAccount.currency) throw httpError(400, "付款方式幣別不符");

    const explicitRequestId = String(body.request_id || "").trim();
    if (manual && !explicitRequestId) throw httpError(400, "request_id required for safe retry");
    const fallbackBucket = Math.floor(new Date(occurredAt).getTime() / 120000);
    const requestId = explicitRequestId || sha256Hex([
      "wallet-v2",
      device.id,
      String(amountMinor),
      merchant || "",
      card || "",
      String(fallbackBucket),
    ].join("|"));
    if (requestId.length > 160) throw httpError(400, "request_id too long");

    const eventResult = await recoverOrInsertEvent(db, {
      user_id: device.user_id,
      device_id: device.id,
      request_id: requestId,
      amount_minor: amountMinor,
      currency,
      merchant_raw: merchant,
      card_raw: card,
      occurred_at: occurredAt,
      status: amountMinor === null || !merchant ? "needs_review" : "received",
      payload: {
        payment_method: manual ? "manual" : "apple_pay",
        time_source: manual ? "manual_entry" : "shortcut_trigger",
        source: manual ? "manual" : "apple_pay",
        direction,
        account_id: match.account?.id || null,
        account_match: match.reason,
        category_id: category?.id || null,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) : null,
        ledger_amount: amountMinor === null ? null : manual
          ? (direction === "income" ? Math.abs(amountMinor) : -Math.abs(amountMinor))
          : (amountMinor < 0 ? Math.abs(amountMinor) : -amountMinor),
      },
    }, device.user_id, requestId);
    const { event, created: eventCreated } = eventResult;

    // Retries must use the first event's normalized fields, never a changed replay.
    const acceptedAmount = event.amount_minor;
    const acceptedMerchant = event.merchant_raw;
    const acceptedCard = event.card_raw;
    const acceptedCurrency = event.currency || currency;
    const acceptedOccurredAt = event.occurred_at || occurredAt;
    const txStatus = acceptedAmount === null || !acceptedMerchant ? "pending" : "confirmed";
    const payload = event.payload || {};
    const ledgerAmount = Object.hasOwn(payload, "ledger_amount") ? payload.ledger_amount : acceptedAmount === null
      ? null
      : (acceptedAmount < 0 ? Math.abs(acceptedAmount) : -acceptedAmount);

    const transactionResult = await recoverOrInsertTransaction(db, {
      user_id: event.user_id,
      device_id: event.device_id,
      request_id: event.request_id,
      source: payload.source === "manual" ? "manual" : "apple_pay",
      account_id: payload.account_id || null,
      category_id: payload.category_id || null,
      note: payload.note || null,
      amount_minor: ledgerAmount,
      currency: acceptedCurrency,
      occurred_at: acceptedOccurredAt,
      merchant: acceptedMerchant,
      merchant_normalized: acceptedMerchant?.toLocaleLowerCase("zh-TW") || null,
      card_label: acceptedCard,
      status: txStatus,
    }, event.user_id, event.request_id);
    const { transaction, created: transactionCreated } = transactionResult;

    await ensureEventLink(db, event, transaction);
    // Heartbeat is useful telemetry, but never makes a confirmed ingest fail.
    try {
      await db.from("ledger_devices").update({
        last_seen_at: new Date().toISOString(),
      }).eq("id", device.id).eq("user_id", device.user_id);
    } catch {
      // Supabase returns update failures in-band; heartbeat remains best-effort.
    }

    const duplicate = !eventCreated || !transactionCreated;
    const unmapped = Boolean(acceptedCard && !payload.account_id);
    const needsReview = transaction.status !== "confirmed" || unmapped;
    const message = duplicate ? "這筆已存在，沒有重複記帳"
      : transaction.status !== "confirmed" ? "已保存，金額或商家缺漏，請到帳本確認"
      : unmapped ? "已記帳；卡片尚未對應，請到設定加入 Wallet 別名"
      : "記帳成功";
    return send(res, duplicate ? 200 : 201, {
      ok: true,
      duplicate,
      tx_id: transaction.id,
      status: transaction.status,
      needs_review: needsReview,
      account_match: payload.account_match || "unmatched",
      amount_minor: ledgerAmount,
      currency: acceptedCurrency,
      merchant: acceptedMerchant,
      message,
    });
  } catch (error) {
    return handleError(res, error);
  }
}
