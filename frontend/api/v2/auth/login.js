import {
  adminClient,
  bodyOf,
  consumeAuthRateLimit,
  handleError,
  httpError,
  internalAuthEmail,
  normalizeUsername,
  publicAuthClient,
  send,
  validPassword,
} from "../../_shared/cloud.js";

function sessionView(session) {
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
  try {
    const db = adminClient();
    await consumeAuthRateLimit(db, req, "login", 20, 15 * 60);
    const body = bodyOf(req);
    const username = normalizeUsername(body.username);
    if (!username || !validPassword(body.password)) throw httpError(401, "Invalid username or password");

    const auth = publicAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({
      email: internalAuthEmail(username),
      password: body.password,
    });
    if (error || !data.session) throw httpError(401, "Invalid username or password");
    return send(res, 200, { ok: true, username, session: sessionView(data.session) });
  } catch (error) {
    return handleError(res, error);
  }
}
