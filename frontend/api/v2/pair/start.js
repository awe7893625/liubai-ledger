import {
  adminClient,
  handleError,
  randomToken,
  requireUser,
  send,
  sha256Hex,
} from "../../_shared/cloud.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const user = await requireUser(req);
    const db = adminClient();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: deleteError } = await db
      .from("ledger_pair_tickets")
      .delete()
      .eq("user_id", user.id)
      .is("used_at", null);
    if (deleteError) throw deleteError;
    const ticket = randomToken(24);
    const ticketHash = sha256Hex(ticket);
    const { error } = await db.from("ledger_pair_tickets").insert({
      user_id: user.id,
      ticket_hash: ticketHash,
      expires_at: expiresAt,
    });
    if (error) throw error;

    return send(res, 201, {
      ok: true,
      pair_ticket: ticket,
      expires_at: expiresAt,
      expires_in_seconds: 600,
      shortcut_name: "留白自動記帳",
    });
  } catch (error) {
    return handleError(res, error);
  }
}
