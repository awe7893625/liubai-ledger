import crypto from "node:crypto";
import {
  adminClient,
  bodyOf,
  consumeAuthRateLimit,
  handleError,
  httpError,
  normalizeUsername,
  randomToken,
  send,
  sha256Hex,
  validPassword,
} from "../../_shared/cloud.js";

function sameHash(left, right) {
  const a = Buffer.from(left || "", "hex");
  const b = Buffer.from(right || "", "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const db = adminClient();
    await consumeAuthRateLimit(db, req, "recover", 10, 60 * 60);
    const body = bodyOf(req);
    const username = normalizeUsername(body.username);
    if (!username || typeof body.recovery_code !== "string" || !validPassword(body.new_password)) {
      throw httpError(400, "Invalid recovery request");
    }

    const { data: profile, error: profileError } = await db
      .from("ledger_profiles")
      .select("user_id")
      .eq("username_norm", username)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw httpError(401, "Invalid username or recovery code");

    const { data: recovery, error: recoveryError } = await db
      .from("ledger_recovery_codes")
      .select("code_hash")
      .eq("user_id", profile.user_id)
      .maybeSingle();
    if (recoveryError) throw recoveryError;
    const suppliedHash = sha256Hex(body.recovery_code.trim());
    if (!recovery || !sameHash(recovery.code_hash, suppliedHash)) {
      throw httpError(401, "Invalid username or recovery code");
    }

    const { error: passwordError } = await db.auth.admin.updateUserById(profile.user_id, {
      password: body.new_password,
    });
    if (passwordError) throw passwordError;

    const newRecoveryCode = `LBR-${randomToken(20)}`;
    const { error: rotateError } = await db
      .from("ledger_recovery_codes")
      .update({ code_hash: sha256Hex(newRecoveryCode), rotated_at: new Date().toISOString() })
      .eq("user_id", profile.user_id);
    if (rotateError) throw rotateError;

    return send(res, 200, {
      ok: true,
      username,
      recovery_code: newRecoveryCode,
      message: "Password updated. Save the new recovery code.",
    });
  } catch (error) {
    return handleError(res, error);
  }
}
