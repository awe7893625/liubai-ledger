import { adminClient, errorResponse, json, options, randomToken, requireUser, sha256Hex } from "../_shared/core.ts";

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    const db = adminClient();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db
      .from("ledger_pair_tickets")
      .delete()
      .eq("user_id", user.id)
      .is("used_at", null);

    const ticket = randomToken(24);
    const ticketHash = await sha256Hex(ticket);
    const { error } = await db.from("ledger_pair_tickets").insert({
      user_id: user.id,
      ticket_hash: ticketHash,
      expires_at: expiresAt,
    });
    if (error) throw error;
    return json({
      ok: true,
      pair_ticket: ticket,
      expires_at: expiresAt,
      expires_in_seconds: 600,
      shortcut_name: "留白自動記帳",
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
});
