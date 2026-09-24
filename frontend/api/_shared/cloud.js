import crypto from "node:crypto";
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
  if (error || !data.user) throw httpError(401, "Invalid session");
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

export function normalizeAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const compact = value.trim().replaceAll(",", "").replaceAll(" ", "");
  const match = compact.match(/^([+-]?)[^\d.-]*(\d+(?:\.\d{1,2})?)$/);
  if (!match) return null;
  const amount = Number(`${match[1]}${match[2]}`);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function normalizedMerchant(value) {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean || null;
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
