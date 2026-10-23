import {
  adminClient,
  bodyOf,
  consumeAuthRateLimit,
  handleError,
  httpError,
  internalAuthEmail,
  normalizeUsername,
  publicAuthClient,
  randomToken,
  send,
  sha256Hex,
  validPassword,
} from "../../_shared/cloud.js";

function sessionView(session) {
  if (!session?.access_token || !session?.refresh_token) throw httpError(503, "Session unavailable");
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    token_type: session.token_type,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  const db = adminClient();
  let createdUserId = null;
  try {
    await consumeAuthRateLimit(db, req, "signup", 5, 24 * 60 * 60);
    const body = bodyOf(req);
    const username = normalizeUsername(body.username);
    if (!username) throw httpError(400, "Username must be 3-24 letters, numbers, _ or -");
    if (!validPassword(body.password)) throw httpError(400, "Password must be 12-128 characters");

    const { count, error: countError } = await db
      .from("ledger_profiles")
      .select("user_id", { count: "exact", head: true })
      .not("username_norm", "is", null);
    if (countError) throw countError;
    if ((count || 0) >= 500) throw httpError(503, "Free beta is currently full");

    const { data: existing, error: existingError } = await db
      .from("ledger_profiles")
      .select("user_id")
      .eq("username_norm", username)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw httpError(409, "Username is already taken");

    const email = internalAuthEmail(username);
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { username },
    });
    if (createError || !created.user) {
      if (/already|registered|exists/i.test(createError?.message || "")) throw httpError(409, "Username is already taken");
      throw createError || new Error("User creation failed");
    }
    createdUserId = created.user.id;

    const recoveryCode = `LBR-${randomToken(20)}`;
    const { error: profileError } = await db.from("ledger_profiles").insert({
      user_id: createdUserId,
      username_norm: username,
      username_display: username,
      locale: "zh-TW",
      timezone: "Asia/Taipei",
      plan: "free",
    });
    if (profileError) throw profileError;
    const { error: recoveryError } = await db.from("ledger_recovery_codes").insert({
      user_id: createdUserId,
      code_hash: sha256Hex(recoveryCode),
    });
    if (recoveryError) throw recoveryError;

    const auth = publicAuthClient();
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({ email, password: body.password });
    if (signInError || !signedIn.session) throw signInError || new Error("Session creation failed");

    return send(res, 201, {
      ok: true,
      username,
      recovery_code: recoveryCode,
      session: sessionView(signedIn.session),
    });
  } catch (error) {
    if (createdUserId) {
      try { await db.auth.admin.deleteUser(createdUserId); } catch { /* cleanup best effort */ }
    }
    return handleError(res, error);
  }
}
