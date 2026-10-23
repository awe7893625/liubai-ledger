import { adminClient, send } from "../_shared/cloud.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const db = adminClient();
    const { error } = await db
      .from("ledger_profiles")
      .select("user_id", { head: true, count: "exact" })
      .limit(1);
    if (error) throw error;
    return send(res, 200, {
      ok: true,
      service: "liubai-ledger-cloud",
      mode: "multi-tenant-free-beta",
    });
  } catch {
    return send(res, 503, {
      ok: false,
      service: "liubai-ledger-cloud",
      error: "Cloud database unavailable",
    });
  }
}
