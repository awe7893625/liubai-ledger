import { httpError, sha256Hex } from "./cloud.js";

export const ACCOUNT_FIELDS = "id,name,type,issuer,currency,card_aliases";
export const ACCOUNT_TYPES = new Set(["card", "cash", "bank", "wallet", "other"]);

export function cardKey(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")
    : "";
}

export function accountInput(body) {
  const name = typeof body.name === "string" ? body.name.normalize("NFKC").trim() : "";
  if (!name || name.length > 80) throw httpError(400, "請填寫 1–80 字的付款方式名稱");
  const type = body.type || "card";
  if (!ACCOUNT_TYPES.has(type)) throw httpError(400, "不支援的付款方式類型");
  // Current UI records TWD. Do not silently mix currencies in monthly totals.
  if (body.currency && body.currency !== "TWD") throw httpError(400, "目前新增付款方式以 TWD 記帳");
  const inputAliases = Array.isArray(body.card_aliases) ? body.card_aliases : [];
  if (inputAliases.length > 12 || inputAliases.some((s) => typeof s !== "string" || s.length > 120)) {
    throw httpError(400, "Wallet 別名最多 12 個，每個不超過 120 字");
  }
  const aliases = [...new Set(inputAliases.map((s) => s.normalize("NFKC").trim()).filter(Boolean))];
  if ([name, ...aliases].some((s) => /(?:\d[ -]?){12,19}/.test(s))) {
    throw httpError(400, "請勿輸入完整卡號；只使用暱稱或末四碼");
  }
  const issuer = typeof body.issuer === "string" ? body.issuer.trim().slice(0, 80) || null : null;
  return { name, type, issuer, currency: "TWD", card_aliases: aliases };
}

export function checkAccountCollision(values, accounts, ownId = null) {
  const keys = new Set([values.name, ...values.card_aliases].map(cardKey));
  for (const account of accounts) {
    if (account.id === ownId) continue;
    if ([account.name, ...(account.card_aliases || [])].some((name) => keys.has(cardKey(name)))) {
      throw httpError(409, "這個名稱或 Wallet 別名已屬於另一個付款方式；請使用可區分的名稱");
    }
  }
}

export function matchAccount(rawCard, accounts) {
  const key = cardKey(rawCard);
  if (!key) return { account: null, reason: "missing" };
  const matches = accounts.filter((a) => [a.name, ...(a.card_aliases || [])].some((s) => cardKey(s) === key));
  return matches.length === 1
    ? { account: matches[0], reason: "matched" }
    : { account: null, reason: matches.length > 1 ? "ambiguous" : "unmatched" };
}

export async function ownedConfig(db, userId) {
  const [accounts, categories, profile] = await Promise.all([
    db.from("ledger_accounts").select(ACCOUNT_FIELDS).eq("user_id", userId).order("created_at", { ascending: true }),
    db.from("ledger_categories").select("id,name,slug").eq("user_id", userId).order("name", { ascending: true }),
    db.from("ledger_profiles").select("username_display").eq("user_id", userId).maybeSingle(),
  ]);
  if (accounts.error) throw accounts.error;
  if (categories.error) throw categories.error;
  if (profile.error) throw profile.error;
  return { accounts: accounts.data || [], categories: categories.data || [], ledger_label: profile.data?.username_display || "我的帳本" };
}

export async function requireDevice(req, db) {
  const raw = String(req.headers["x-ledger-device-token"] || "").trim()
    || String(req.headers.authorization || "").replace(/^Device /, "").trim();
  if (!/^ldb_dev_[A-Za-z0-9_-]{32,100}$/.test(raw)) throw httpError(401, "請先在網站設定中連接這支 iPhone");
  const { data, error } = await db.from("ledger_devices")
    .select("id,user_id,name,revoked_at").eq("token_hash", sha256Hex(raw)).is("revoked_at", null).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(401, "裝置未配對或已解除，請重新連接 iPhone");
  return data;
}
