import crypto from "node:crypto";
import { BlockList, isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";

export function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

export function send(res, status, body) {
  setNoStore(res);
  return res.status(status).json(body);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function publishableKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  );
}
function secretKey() {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

export function adminClient() {
  const key = secretKey();
  if (!key) throw new Error("Missing Supabase secret key");
  return createClient(required("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function publicAuthClient() {
  const key = publishableKey();
  if (!key) throw new Error("Missing Supabase publishable key");
  return createClient(required("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) throw httpError(401, "Sign in required");
  const token = auth.slice(7).trim();
  const key = publishableKey();
  if (!key) throw new Error("Missing Supabase publishable key");
  const client = createClient(required("SUPABASE_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    // Log only an upstream error code/status, never a JWT, user ID, or financial data.
    if (error) console.warn("ledger_auth_validation", { status: error.status, code: error.code || error.name });
    if (error?.status === 429) throw httpError(429, "登入驗證服務忙碌，請稍後重試");
    if (error && (!error.status || error.status >= 500)) throw httpError(503, "暫時無法驗證登入，請稍後重試");
    throw httpError(401, "Invalid session");
  }
  return data.user;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function normalizeUsername(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) return null;
  const reserved = new Set([
    "admin", "administrator", "api", "auth", "billing", "help", "ledger",
    "liubai", "login", "owner", "root", "security", "signup", "support",
    "system", "wallet", "www",
  ]);
  return reserved.has(normalized) ? null : normalized;
}

export function internalAuthEmail(username) {
  return `u-${sha256Hex(`liubai:${username}`).slice(0, 32)}@users.liubai.invalid`;
}

export function validPassword(value) {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

// Cloudflare public proxy ranges: https://www.cloudflare.com/ips/ (reviewed 2026-10-21).
const cloudflareProxyRanges = new BlockList();
[
  ["173.245.48.0", 20], ["103.21.244.0", 22], ["103.22.200.0", 22],
  ["103.31.4.0", 22], ["141.101.64.0", 18], ["108.162.192.0", 18],
  ["190.93.240.0", 20], ["188.114.96.0", 20], ["197.234.240.0", 22],
  ["198.41.128.0", 17], ["162.158.0.0", 15], ["104.16.0.0", 13],
  ["104.24.0.0", 14], ["172.64.0.0", 13], ["131.0.72.0", 22],
].forEach(([address, prefix]) => cloudflareProxyRanges.addSubnet(address, prefix, "ipv4"));
[
  ["2400:cb00::", 32], ["2606:4700::", 32], ["2803:f800::", 32],
  ["2405:b500::", 32], ["2405:8100::", 32], ["2a06:98c0::", 29],
  ["2c0f:f248::", 32],
].forEach(([address, prefix]) => cloudflareProxyRanges.addSubnet(address, prefix, "ipv6"));

function firstForwarded(value) {
  return String(value || "").split(",")[0].trim().slice(0, 96);
}

function fromCloudflareProxy(value) {
  const ip = firstForwarded(value);
  const family = isIP(ip);
  if (family === 4) return cloudflareProxyRanges.check(ip, "ipv4");
  if (family === 6) return cloudflareProxyRanges.check(ip, "ipv6");
  return false;
}

export function requestClientIp(req) {
  const vercelPeer = firstForwarded(req.headers["x-vercel-forwarded-for"]);
  const cloudflareClient = firstForwarded(req.headers["cf-connecting-ip"]);
  if (cloudflareClient && fromCloudflareProxy(vercelPeer)) return cloudflareClient;
  return (
    vercelPeer ||
    firstForwarded(req.headers["x-forwarded-for"]) ||
    firstForwarded(req.headers["x-real-ip"]) ||
    "unknown"
  );
}

export async function consumeAuthRateLimit(db, req, route, maxAttempts, windowSeconds) {
  const ip = requestClientIp(req);
  const secret = secretKey();
  const bucketHash = crypto.createHmac("sha256", secret).update(`${route}:${ip}`).digest("hex");
  const now = new Date();
  const since = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const { error: insertError } = await db.from("ledger_auth_attempts").insert({
    route,
    bucket_hash: bucketHash,
    created_at: now.toISOString(),
  });
  if (insertError) throw insertError;
  const { count, error: countError } = await db
    .from("ledger_auth_attempts")
    .select("id", { count: "exact", head: true })
    .eq("route", route)
    .eq("bucket_hash", bucketHash)
    .gte("created_at", since);
  if (countError) throw countError;
  if ((count || 0) > maxAttempts) throw httpError(429, "Too many attempts. Try again later.");

  const retentionCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { error: cleanupError } = await db
    .from("ledger_auth_attempts")
    .delete()
    .eq("route", route)
    .lt("created_at", retentionCutoff);
  if (cleanupError) console.warn("Auth rate-limit cleanup failed", cleanupError.message);
}

export function normalizeAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const minor = Math.round(value * 100);
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof value !== "string") return null;
  const compact = value.trim().replaceAll(",", "").replaceAll(" ", "");
  const match = compact.match(/^([+-]?)[^\d.-]*(\d+(?:\.\d{1,2})?)$/);
  if (!match) return null;
  const amount = Number(`${match[1]}${match[2]}`);
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function normalizedMerchant(value) {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, 240) : null;
}

export function safeCurrency(value) {
  const raw = typeof value === "string" ? value.toUpperCase() : "";
  return /^[A-Z]{3}$/.test(raw) ? raw : "TWD";
}

export function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      throw httpError(400, "Invalid JSON");
    }
  }
  return {};
}

export function handleError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(error);
  return send(res, status, { ok: false, error: status >= 500 ? "Internal error" : error.message });
}
