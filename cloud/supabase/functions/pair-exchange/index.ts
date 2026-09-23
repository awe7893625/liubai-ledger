import { adminClient, errorResponse, HttpError, json, options, randomToken, sha256Hex } from "../_shared/core.ts";

type PairBody = {
  pair_ticket?: string;
  device_name?: string;
};

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json() as PairBody;
    const rawTicket = (body.pair_ticket ?? "").trim().replace(/^pair:/, "");
    if (rawTicket.length < 24) throw new HttpError(400, "Invalid pairing ticket");

    const ticketHash = await sha256Hex(rawTicket);
    const db = adminClient();
    const now = new Date().toISOString();

    const { data: ticket, error: findError } = await db
      .from("ledger_pair_tickets")
      .select("id,user_id,expires_at,used_at")
      .eq("ticket_hash", ticketHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (findError) throw findError;
    if (!ticket) throw new HttpError(410, "Pairing link expired or already used");

    const { data: claimed, error: claimError } = await db
      .from("ledger_pair_tickets")
      .update({ used_at: now })
      .eq("id", ticket.id)
      .is("used_at", null)
      .select("user_id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new HttpError(409, "Pairing link already used");

    const deviceToken = `ldb_dev_${randomToken(32)}`;
    const tokenHash = await sha256Hex(deviceToken);
    const deviceName = (body.device_name ?? "iPhone").trim().slice(0, 80) || "iPhone";
    const { data: device, error: deviceError } = await db
      .from("ledger_devices")
      .insert({
        user_id: ticket.user_id,
        name: deviceName,
        token_hash: tokenHash,
        last_seen_at: now,
      })
      .select("id,name,created_at")
      .single();
    if (deviceError) throw deviceError;

    return json({
      ok: true,
      device_token: deviceToken,
      device,
      ingest_path: "/functions/v1/wallet-ingest",
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
