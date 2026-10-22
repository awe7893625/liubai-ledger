import { httpError } from "./cloud.js";

const KINDS = new Set(["expense", "income", "refund", "transfer"]);
export function kindOf(value, fallback = "expense") {
  const kind = value ?? fallback;
  if (!KINDS.has(kind)) throw httpError(400, "Invalid transaction kind");
  return kind;
}
export function existingKind(row) {
  return KINDS.has(row.legacy_kind) ? row.legacy_kind : row.amount_minor > 0 ? "income" : "expense";
}
export function signedAmount(amount, kind, direction) {
  if (kind === "refund" || kind === "income") return Math.abs(amount);
  if (kind === "expense") return -Math.abs(amount);
  if (!["income", "expense"].includes(direction)) throw httpError(400, "轉帳紀錄需指定轉入或轉出");
  return direction === "income" ? Math.abs(amount) : -Math.abs(amount);
}

// A retry may retrieve a committed row only if the meaningful request is unchanged.
// Derived labels can change after an account is renamed. Unspecified timestamp is
// intentionally not compared: older manual clients let the server set it.
export function assertReplayMatches(current, requested, body) {
  const fields = ["amount_minor", "currency", "merchant", "account_id", "category_id", "note"];
  const same = fields.every((key) => (current[key] ?? null) === (requested[key] ?? null));
  const sameKind = existingKind(current) === requested.legacy_kind;
  const sameDate = body.occurred_at == null || Date.parse(current.occurred_at) === Date.parse(requested.occurred_at);
  const sameCard = !body.card || requested.account_id || (current.card_label ?? null) === requested.card_label;
  if (!same || !sameKind || !sameDate || !sameCard || current.source !== "manual") {
    throw httpError(409, "這個請求編號已用於不同內容。請先查看原交易，不要把衝突當成入帳成功。");
  }
}

// Even legacy clients that omit a revision get a read/compare/write guard.
// Increment by >=1ms so updates within one clock tick cannot reuse a version.
export function nextRevision(current) {
  const old = Date.parse(current.updated_at || "");
  return new Date(Math.max(Date.now(), Number.isFinite(old) ? old + 1 : 0)).toISOString();
}
export function checkExpectedRevision(body, current) {
  if (body.expected_updated_at !== undefined) {
    if (typeof body.expected_updated_at !== "string" || !body.expected_updated_at || body.expected_updated_at !== current.updated_at) {
      throw httpError(409, "交易已被更新，請重新載入後再操作");
    }
  }
}
