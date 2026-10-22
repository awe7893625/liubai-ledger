export type AuthRoute = "login" | "signup" | "recover" | "google";
export type AuthCooldowns = Partial<Record<AuthRoute, number>>;
export const AUTH_RETRY_KEY = "ledger-auth-cooldowns-v1";
const ROUTES: AuthRoute[] = ["login", "signup", "recover", "google"];
const WINDOWS: Record<AuthRoute, number> = { signup: 86400, login: 900, recover: 3600, google: 900 };
const MAX_RETRY_SECONDS = 604800;

export class AuthRequestError extends Error {
  readonly status: number;
  readonly route: AuthRoute;
  readonly retryAt: number | null;
  constructor(message: string, status: number, route: AuthRoute, retryAt: number | null = null) {
    super(message); this.name = "AuthRequestError";
    this.status = status; this.route = route; this.retryAt = retryAt;
  }
}

export function routeForAuth(path: string): AuthRoute {
  const segment = path.split("/").pop();
  return ROUTES.includes(segment as AuthRoute) ? segment as AuthRoute : "login";
}

export function retryDeadline(header: string | null, body: unknown, route: AuthRoute, now = Date.now()): number {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>).retry_after_seconds : undefined;
  let seconds = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : NaN;
  if (!Number.isFinite(seconds) && header) {
    if (/^\d+$/.test(header.trim())) seconds = Number(header.trim());
    else {
      const date = Date.parse(header);
      if (Number.isFinite(date)) seconds = Math.ceil((date - now) / 1000);
    }
  }
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = WINDOWS[route];
  return now + Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(seconds))) * 1000;
}

export function sanitizedCooldowns(raw: unknown, now = Date.now()): AuthCooldowns {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: AuthCooldowns = {};
  for (const route of ROUTES) {
    const value = source[route];
    if (typeof value === "number" && Number.isFinite(value) && value > now && value <= now + MAX_RETRY_SECONDS * 1000) result[route] = value;
  }
  return result;
}

export function cooldownLabel(deadline: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  if (!seconds) return "可以重試";
  if (seconds < 60) return `約 ${seconds} 秒後可重試`;
  if (seconds < 3600) return `約 ${Math.ceil(seconds / 60)} 分鐘後可重試`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `約 ${hours} 小時${minutes ? ` ${minutes} 分鐘` : ""}後可重試`;
}

export function publicAuthError(status: number, body: unknown, route: AuthRoute): string {
  const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
    ? String((body as Record<string, unknown>).error) : "";
  if (status === 429) return "這個網路來源的嘗試次數已達上限。請依下方時間再試，連續按重試會延長等待。";
  if (status === 409 && route === "signup") return "這個帳號名稱已被使用，請選另一個名稱；已有帳號請切換登入。";
  if (status === 401) return route === "recover" ? "帳號或復原碼不正確。" : route === "google" ? "Google 驗證未完成，請重新選擇帳號。" : "帳號或密碼不正確。";
  if (status === 503 && /full/i.test(error)) return "免費測試版名額已滿，暫停新增帳號；已有帳號仍可登入。";
  if (status >= 500) return "登入服務暫時無法使用。請保留資料，稍後再試。";
  if (/Username must/i.test(error)) return "帳號需為 3–24 個英文字母、數字、底線或連字號。";
  if (/Password must/i.test(error)) return "密碼需為 12–128 個字元。";
  return "無法完成這次驗證，請檢查輸入後再試。";
}
