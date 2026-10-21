import { OAuth2Client } from "google-auth-library";
import {
  adminClient,
  bodyOf,
  consumeAuthRateLimit,
  handleError,
  httpError,
  publicAuthClient,
  randomToken,
  send,
  sha256Hex,
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

function requiredGoogleClientId() {
  const value = process.env.GOOGLE_WEB_CLIENT_ID || process.env.VITE_GOOGLE_WEB_CLIENT_ID;
  if (!value) throw httpError(503, "Google sign-in is not configured");
  return value;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  const db = adminClient();
  let createdUserId = null;
  try {
    await consumeAuthRateLimit(db, req, "google", 20, 15 * 60);
    const body = bodyOf(req);
    const credential = typeof body.credential === "string" ? body.credential.trim() : "";
    if (!credential || credential.length > 10000) throw httpError(400, "Google credential required");

    const clientId = requiredGoogleClientId();
    const verifier = new OAuth2Client(clientId);
    let payload;
    try {
      const ticket = await verifier.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw httpError(401, "Invalid Google credential");
    }
    if (!payload?.sub || payload.email_verified !== true) throw httpError(401, "Unverified Google account");

    const subjectHash = sha256Hex(`google:${payload.sub}`);
    const internalUsername = `g-${subjectHash.slice(0, 20)}`;
    const internalEmail = `g-${subjectHash.slice(0, 32)}@users.liubai.invalid`;
    const password = randomToken(32);

    const { data: identity, error: identityError } = await db
      .from("ledger_google_identities")
      .select("user_id")
      .eq("subject_hash", subjectHash)
      .maybeSingle();
    if (identityError) throw identityError;

    let userId = identity?.user_id || null;
    if (userId) {
      const { error: updateError } = await db.auth.admin.updateUserById(userId, {
        password,
        user_metadata: {
          provider: "google",
          display_name: typeof payload.name === "string" ? payload.name.slice(0, 120) : "Google 使用者",
        },
      });
      if (updateError) throw updateError;
      const { error: touchError } = await db
        .from("ledger_google_identities")
        .update({ last_login_at: new Date().toISOString() })
        .eq("subject_hash", subjectHash);
      if (touchError) throw touchError;
    } else {
      const { count, error: countError } = await db
        .from("ledger_profiles")
        .select("user_id", { count: "exact", head: true });
      if (countError) throw countError;
      if ((count || 0) >= 500) throw httpError(503, "Free beta is currently full");

      const { data: created, error: createError } = await db.auth.admin.createUser({
        email: internalEmail,
        password,
        email_confirm: true,
        user_metadata: {
          provider: "google",
          display_name: typeof payload.name === "string" ? payload.name.slice(0, 120) : "Google 使用者",
        },
      });
      if (createError || !created.user) throw createError || new Error("Google user creation failed");
      createdUserId = created.user.id;
      userId = created.user.id;

      const { error: profileError } = await db.from("ledger_profiles").insert({
        user_id: userId,
        username_norm: internalUsername,
        username_display: typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim().slice(0, 80)
          : "Google 使用者",
        locale: "zh-TW",
        timezone: "Asia/Taipei",
        plan: "free",
      });
      if (profileError) throw profileError;

      const { error: mapError } = await db.from("ledger_google_identities").insert({
        subject_hash: subjectHash,
        user_id: userId,
      });
      if (mapError) throw mapError;
    }

    const auth = publicAuthClient();
    const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({
      email: internalEmail,
      password,
    });
    if (signInError || !signedIn.session) throw signInError || new Error("Google session creation failed");

    return send(res, 200, {
      ok: true,
      provider: "google",
      session: sessionView(signedIn.session),
    });
  } catch (error) {
    if (createdUserId) {
      try { await db.auth.admin.deleteUser(createdUserId); } catch { /* cleanup best effort */ }
    }
    return handleError(res, error);
  }
}
