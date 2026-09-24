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

    const eventStatus = amountMinor === null || !merchant ? "needs_review" : "received";
    const { data: event, error: eventError } = await db
      .from("ledger_wallet_events")
      .insert({
        user_id: device.user_id,
        device_id: device.id,
        request_id: requestId,
        amount_minor: amountMinor,
        currency,
        merchant_raw: merchant,
        card_raw: card,
        occurred_at: occurredAt,
        status: eventStatus,
        payload: {
          payment_method: body.payment_method || "apple_pay",
          time_source: body.time_source || "shortcut_trigger",
        },
      })
      .select("id")
      .maybeSingle();

    if (eventError?.code === "23505") {
      const { data: duplicate } = await db
        .from("ledger_wallet_events")
        .select("transaction_id,status")
        .eq("user_id", device.user_id)
        .eq("request_id", requestId)
        .maybeSingle();
      return send(res, 200, {
        ok: true,
        duplicate: true,
        tx_id: duplicate?.transaction_id || null,
      });
    }
    if (eventError) throw eventError;
    if (!event) throw new Error("Wallet event insert returned no row");

    const txStatus = amountMinor === null || !merchant ? "pending" : "confirmed";
    const ledgerAmount = amountMinor === null
      ? null
      : (amountMinor < 0 ? Math.abs(amountMinor) : -amountMinor);

    const { data: transaction, error: txError } = await db
      .from("ledger_transactions")
      .insert({
        user_id: device.user_id,
        device_id: device.id,
        request_id: requestId,
        source: "apple_pay",
        amount_minor: ledgerAmount,
        currency,
        occurred_at: occurredAt,
        merchant,
        merchant_normalized: merchant?.toLocaleLowerCase("zh-TW") || null,
        card_label: card,
        status: txStatus,
      })
      .select("id,status")
      .single();

    if (txError) {
      await db.from("ledger_wallet_events").delete().eq("id", event.id);
      throw txError;
    }

    await Promise.all([
      db.from("ledger_wallet_events").update({
        status: txStatus === "confirmed" ? "processed" : "needs_review",
        transaction_id: transaction.id,
      }).eq("id", event.id),
      db.from("ledger_devices").update({
        last_seen_at: new Date().toISOString(),
      }).eq("id", device.id),
    ]);
    return send(res, 201, {
      ok: true,
      duplicate: false,
      tx_id: transaction.id,
      status: transaction.status,
      needs_review: txStatus !== "confirmed",
    });
  } catch (error) {
    return handleError(res, error);
  }
}
