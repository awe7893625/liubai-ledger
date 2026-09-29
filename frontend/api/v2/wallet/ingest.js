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

function deviceToken(req) {
  const explicit = String(req.headers["x-ledger-device-token"] || "").trim();
  if (explicit) return explicit;
  const authorization = String(req.headers.authorization || "").trim();
  if (authorization.startsWith("Device ")) return authorization.slice(7).trim();
  throw httpError(401, "Device token required");
}

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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const rawToken = deviceToken(req);
    if (!rawToken.startsWith("ldb_dev_") || rawToken.length < 40) {
      throw httpError(401, "Invalid device token");
    }
    const db = adminClient();
    const tokenHash = sha256Hex(rawToken);
    const { data: device, error: deviceError } = await db
      .from("ledger_devices")
      .select("id,user_id,revoked_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) throw httpError(401, "Unknown or revoked device");

    const body = bodyOf(req);
    const amountMinor = normalizeAmount(body.amount);
    const merchant = normalizedMerchant(body.merchant);
    const card = normalizedMerchant(body.card);
    const occurredAt = body.occurred_at && !Number.isNaN(Date.parse(body.occurred_at))
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();
    const currency = safeCurrency(body.currency);

    const explicitRequestId = String(body.request_id || "").trim();
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
        payment_method: body.payment_method || "apple_pay",
        time_source: body.time_source || "shortcut_trigger",
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
    const ledgerAmount = acceptedAmount === null
      ? null
      : (acceptedAmount < 0 ? Math.abs(acceptedAmount) : -acceptedAmount);

    const transactionResult = await recoverOrInsertTransaction(db, {
      user_id: event.user_id,
      device_id: event.device_id,
      request_id: event.request_id,
      source: "apple_pay",
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
    return send(res, duplicate ? 200 : 201, {
      ok: true,
      duplicate,
      tx_id: transaction.id,
      status: transaction.status,
      needs_review: transaction.status !== "confirmed",
    });
  } catch (error) {
    return handleError(res, error);
  }
}
