import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("LEDGER_ALLOWED_ORIGIN") ?? "https://liubai-ledger.vercel.app",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-ledger-device-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Cache-Control": "no-store",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function options(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: corsHeaders }) : null;
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function namedKey(jsonEnv: string, legacyEnv: string): string {
  const raw = Deno.env.get(jsonEnv);
  if (raw) {
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return env(legacyEnv);
}

export function adminClient(): SupabaseClient {
  const secret = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  return createClient(env("SUPABASE_URL"), secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request): Promise<{ id: string; email?: string }> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) throw new HttpError(401, "Sign in required");
  const publishable = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const client = createClient(env("SUPABASE_URL"), publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Invalid session");
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  const base64 = btoa(String.fromCharCode(...value));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function normalizeAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  const compact = value.trim().replaceAll(",", "").replaceAll(" ", "");
  const match = compact.match(/^([+-]?)[^\d.-]*(\d+(?:\.\d{1,2})?)$/);
  if (!match) return null;
  const amount = Number(`${match[1]}${match[2]}`);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function normalizedMerchant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean : null;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status);
  console.error(error);
  return json({ ok: false, error: "Internal error" }, 500);
}
