import { adminClient, errorResponse, HttpError, json, normalizeAmount, normalizedMerchant, options, sha256Hex } from "../_shared/core.ts";

type WalletBody = {
  request_id?: string;
  amount?: unknown;
  currency?: string;
  merchant?: unknown;
  card?: unknown;
  occurred_at?: string;
  payment_method?: string;
  time_source?: string;
};

function deviceToken(req: Request): string {
  const explicit = (
    req.headers.get("X-Ledger-Device-Token") ??
    req.headers.get("X-Ledger-Device")
  )?.trim();
  if (explicit) return explicit;
  const authorization = req.headers.get("Authorization")?.trim() ?? "";
  if (authorization.startsWith("Device ")) return authorization.slice(7).trim();
  throw new HttpError(401, "Device token required");
}

function safeCurrency(value: unknown): string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value.toUpperCase())
    ? value.toUpperCase()
    : "TWD";
}

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const rawToken = deviceToken(req);
    if (!rawToken.startsWith("ldb_dev_") || rawToken.length < 40) throw new HttpError(401, "Invalid device token");
    const tokenHash = await sha256Hex(rawToken);
    const db = adminClient();
    const { data: device, error: deviceError } = await db
      .from("ledger_devices")
      .select("id,user_id,revoked_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) throw new HttpError(401, "Unknown or revoked device");

    const body = await req.json() as WalletBody;
    const amountMinor = normalizeAmount(body.amount);
    const merchant = normalizedMerchant(body.merchant);
    const card = normalizedMerchant(body.card);
    const occurredAt = body.occurred_at && !Number.isNaN(Date.parse(body.occurred_at))
      ? new Date(body.occurred_at).toISOString()
      : new Date().toISOString();
    const currency = safeCurrency(body.currency);

    const explicitRequestId = (body.request_id ?? "").trim();
    const fallbackBucket = Math.floor(new Date(occurredAt).getTime() / 120000);
    const requestId = explicitRequestId || await sha256Hex([
      "wallet-v2", device.id, String(amountMinor), merchant ?? "", card ?? "", String(fallbackBucket),
    ].join("|"));

    if (requestId.length > 160) throw new HttpError(400, "request_id too long");

    const eventStatus = amountMinor === null || !merchant ? "needs_review" : "received";
    const { data: insertedEvent, error: eventError } = await db
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
          payment_method: body.payment_method ?? "apple_pay",
          time_source: body.time_source ?? "shortcut_trigger",
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
      return json({ ok: true, duplicate: true, tx_id: duplicate?.transaction_id ?? null }, 200);
    }
    if (eventError) throw eventError;
    if (!insertedEvent) throw new Error("Wallet event insert returned no row");

    const txStatus = amountMinor === null || !merchant ? "pending" : "confirmed";
    const { data: transaction, error: txError } = await db
      .from("ledger_transactions")
      .insert({
        user_id: device.user_id,
        device_id: device.id,
        request_id: requestId,
        source: "apple_pay",
        amount_minor: amountMinor === null ? null : (amountMinor < 0 ? Math.abs(amountMinor) : -amountMinor),
        currency,
        occurred_at: occurredAt,
        merchant,
        merchant_normalized: merchant?.toLocaleLowerCase("zh-TW") ?? null,
        card_label: card,
        status: txStatus,
      })
      .select("id,status")
      .single();

    if (txError) {
      // Keep retry semantics: if transaction persistence failed, remove this
      // staging event so the same request_id can be retried rather than being
      // reported as a successful duplicate with no transaction.
      await db.from("ledger_wallet_events").delete().eq("id", insertedEvent.id);
      throw txError;
    }
    await Promise.all([
      db.from("ledger_wallet_events").update({
        status: txStatus === "confirmed" ? "processed" : "needs_review",
        transaction_id: transaction.id,
      }).eq("id", insertedEvent.id),
      db.from("ledger_devices").update({
        last_seen_at: new Date().toISOString(),
      }).eq("id", device.id),
    ]);

    return json({
      ok: true,
      duplicate: false,
      tx_id: transaction.id,
      status: transaction.status,
      needs_review: txStatus !== "confirmed",
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
