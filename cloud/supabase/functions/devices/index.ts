import { adminClient, errorResponse, HttpError, json, options, requireUser } from "../_shared/core.ts";

type RevokeBody = {
  device_id?: string;
};

Deno.serve(async (req) => {
  const preflight = options(req);
  if (preflight) return preflight;

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
      return json({ ok: true, devices: data ?? [] });
    }

    if (req.method !== "POST" && req.method !== "PATCH") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const body = await req.json() as RevokeBody;
    const deviceId = (body.device_id ?? "").trim();
    if (!deviceId) throw new HttpError(400, "device_id required");
    const { data: device, error } = await db
      .from("ledger_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .select("id,name,revoked_at")
      .maybeSingle();
    if (error) throw error;
    if (!device) throw new HttpError(404, "Device not found or already revoked");

    return json({ ok: true, device });
  } catch (error) {
    return errorResponse(error);
  }
});
