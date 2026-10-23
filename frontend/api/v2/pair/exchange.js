import {
  adminClient,
  bodyOf,
  handleError,
  httpError,
  randomToken,
  send,
  sha256Hex,
} from "../../_shared/cloud.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = bodyOf(req);
    const rawTicket = String(body.pair_ticket || "").trim().replace(/^pair:/, "");
    if (rawTicket.length < 24) throw httpError(400, "Invalid pairing ticket");

    const db = adminClient();
    const now = new Date().toISOString();
    const ticketHash = sha256Hex(rawTicket);
    const { data: ticket, error: findError } = await db
      .from("ledger_pair_tickets")
      .select("id,user_id,expires_at,used_at")
      .eq("ticket_hash", ticketHash)
      .is("used_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (findError) throw findError;
    if (!ticket) throw httpError(410, "Pairing link expired or already used");

    const { data: claimed, error: claimError } = await db
      .from("ledger_pair_tickets")
      .update({ used_at: now })
      .eq("id", ticket.id)
      .is("used_at", null)
      .select("user_id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw httpError(409, "Pairing link already used");
    const deviceToken = `ldb_dev_${randomToken(32)}`;
    const tokenHash = sha256Hex(deviceToken);
    const deviceName = String(body.device_name || "iPhone").trim().slice(0, 80) || "iPhone";

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

    return send(res, 201, {
      ok: true,
      device_token: deviceToken,
      device,
      ingest_path: "/api/v2/wallet/ingest",
    });
  } catch (error) {
    return handleError(res, error);
  }
}
