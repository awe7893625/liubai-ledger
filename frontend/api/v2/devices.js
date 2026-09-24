import {
  adminClient,
  bodyOf,
  handleError,
  httpError,
  requireUser,
  send,
} from "../_shared/cloud.js";

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const db = adminClient();

    if (req.method === "GET") {
      const { data, error } = await db
        .from("ledger_devices")
        .select("id,name,created_at,last_seen_at,revoked_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return send(res, 200, { ok: true, devices: data || [] });
    }

    if (req.method !== "POST" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET, POST, PATCH");
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }
    const body = bodyOf(req);
    const deviceId = String(body.device_id || "").trim();
    if (!deviceId) throw httpError(400, "device_id required");

    const { data: device, error } = await db
      .from("ledger_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id,name,revoked_at")
      .maybeSingle();
    if (error) throw error;
    if (!device) throw httpError(404, "Device not found or already revoked");

    return send(res, 200, { ok: true, device });
  } catch (error) {
    return handleError(res, error);
  }
}
