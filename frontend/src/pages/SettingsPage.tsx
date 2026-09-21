// Settings — 帳戶／分類／匯入維護（新增、封存、刪除保護、匯入歷史唯讀）
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Download,
  MapPin,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import type { Account, AccountType, Category } from "../types";
import { formatMinor } from "../utils/money";
import { useStore } from "../store/useStore";

// 本頁自行呼叫 API（api/index.ts 尚無 delete / imports 端點），錯誤訊息取後端 detail
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `API ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown };
      if (typeof data.detail === "string") message = data.detail;
    } catch {
      /* 非 JSON 回應就保留 status code */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "未知錯誤";
}

/** GET /api/categories 回傳的欄位 + 後端附加的 spent_minor */
type CategoryRow = Category & { spent_minor?: number };

/** GET /api/imports 回傳的 statement_imports 列 */
interface StatementImport {
  id: string;
  funding_account_id: string;
  file_path: string;
  statement_period: string | null;
  import_status: "pending" | "processing" | "completed" | "failed";
  imported_count: number;
  error_log: string | null;
  created_at: string;
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  credit_card: "信用卡",
  cash: "現金",
  bank_account: "銀行帳戶",
  other: "其他",
};

const EXPORT_FORMATS: Array<{ format: string; label: string }> = [
  { format: "xlsx", label: "Excel .xlsx" },
  { format: "csv", label: "CSV" },
  { format: "md", label: "Markdown .md" },
  { format: "json", label: "JSON 備份" },
];

// /api 由反向代理掛在網域根目錄，不隨 SPA 的 /ledger/ base path 移動，故用絕對網址而非相對於目前路徑
function openExport(format: string) {
  window.open(`https://${location.host}/api/export?format=${format}`, "_blank");
}

const exportActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-md)",
  paddingTop: "var(--space-sm)",
};

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: "bank_account", label: "銀行帳戶" },
  { value: "credit_card", label: "信用卡" },
  { value: "cash", label: "現金" },
  { value: "other", label: "其他" },
];

const IMPORT_STATUS_META: Record<
  StatementImport["import_status"],
  { label: string; className?: string }
> = {
  pending: { label: "待處理", className: "status-badge--pending" },
  processing: { label: "處理中" },
  completed: { label: "已完成", className: "status-badge--confirmed" },
  failed: { label: "失敗", className: "status-badge--duplicate" },
};

const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-md)",
  minHeight: "var(--touch-target)",
  padding: "var(--space-sm) 0",
};

const rowMainStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minWidth: 0,
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const rowTitleLine: CSSProperties = {
  display: "flex",
  minWidth: 0,
  alignItems: "center",
  gap: "var(--space-sm)",
};

const rowTitleStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.95rem",
  fontWeight: 650,
};

const rowMetaStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "0.72rem",
};

const rowMoneyStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "0.9rem",
  fontWeight: 650,
};

const rowActionsStyle: CSSProperties = {
  display: "flex",
  flex: "0 0 auto",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const sheetHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-md)",
  marginBottom: "var(--space-lg)",
};

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
};

const formActionsStyle: CSSProperties = {
  display: "flex",
  gap: "var(--space-md)",
  marginTop: "var(--space-sm)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "var(--touch-target)",
  padding: "0 var(--space-md)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  fontSize: "0.95rem",
};

const fieldErrorStyle: CSSProperties = {
  color: "var(--error)",
  fontSize: "0.8rem",
  fontWeight: 600,
};

const hintStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "0.75rem",
};

const dangerActionStyle: CSSProperties = {
  flex: 1,
  background: "var(--error)",
  borderColor: "var(--error)",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        color: "var(--text-secondary)",
        fontSize: "0.8rem",
        fontWeight: 600,
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: "30rem" }}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div style={sheetHeaderStyle}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 650 }}>{title}</h2>
          <button className="icon-button" type="button" aria-label="關閉" onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div aria-hidden="true" style={listStyle}>
      <div className="skeleton" style={{ height: "2.75rem" }} />
      <div className="skeleton" style={{ height: "2.75rem", marginTop: "var(--space-sm)" }} />
      <div className="skeleton" style={{ height: "2.75rem", marginTop: "var(--space-sm)" }} />
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        padding: "var(--space-sm) 0",
        color: "var(--text-secondary)",
        fontSize: "0.85rem",
      }}
    >
      <AlertCircle
        size={18}
        strokeWidth={1.8}
        style={{ color: "var(--error)", flexShrink: 0 }}
        aria-hidden="true"
      />
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {message}
      </span>
      <button className="text-action" type="button" onClick={onRetry}>
        <RefreshCcw size={15} aria-hidden="true" />
        重試
      </button>
    </div>
  );
}

function InlineHint({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-xs) var(--space-md)",
        padding: "var(--space-md) 0",
        color: "var(--text-secondary)",
        fontSize: "0.85rem",
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

function SettingsSection({
  eyebrow,
  title,
  titleId,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  titleId: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card dashboard-card" aria-labelledby={titleId}>
      <div className="card-heading">
        <div>
          <p className="section-eyebrow">{eyebrow}</p>
          <h2 className="section-title" id={titleId}>
            {title}
          </h2>
          {description ? <p className="section-description">{description}</p> : null}
        </div>
        {action ? <div className="section-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function AccountSheet({
  account,
  onClose,
  onSubmit,
}: {
  account: Account | null;
  onClose: () => void;
  onSubmit: (payload: Partial<Account>) => Promise<void>;
}) {
  const [nickname, setNickname] = useState(account?.nickname ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank_account");
  const [issuer, setIssuer] = useState(account?.issuer ?? "");
  const [last4, setLast4] = useState(account?.last4 ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guardedClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = nickname.trim();
    if (!name) {
      setError("請輸入帳戶名稱");
      return;
    }
    const digits = last4.trim();
    if (digits && !/^\d{4}$/.test(digits)) {
      setError("末四碼需為 4 位數字");
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload: Partial<Account> = account
      ? { nickname: name, type }
      : { nickname: name, type, issuer: issuer.trim() || null, last4: digits || null };
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(errorMessage(e)); // 失敗保留全部輸入
      setSubmitting(false);
    }
  };

  return (
    <Sheet title={account ? "編輯帳戶" : "新增帳戶"} onClose={guardedClose}>
      <form style={formStyle} onSubmit={(event) => void handleSubmit(event)}>
        <Field label="名稱">
          <input
            style={inputStyle}
            value={nickname}
            maxLength={40}
            placeholder="例如：台新 Cash 信用卡"
            onChange={(event) => setNickname(event.target.value)}
            autoFocus
          />
        </Field>
        <Field label="類型">
          <select
            style={inputStyle}
            value={type}
            onChange={(event) => setType(event.target.value as AccountType)}
          >
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {account ? (
          <p style={hintStyle}>發卡機構與末四碼僅能在新增時設定。</p>
        ) : (
          <>
            <Field label="發卡機構（選填）">
              <input
                style={inputStyle}
                value={issuer}
                maxLength={40}
                placeholder="例如：台新銀行"
                onChange={(event) => setIssuer(event.target.value)}
              />
            </Field>
            <Field label="末四碼（選填）">
              <input
                style={inputStyle}
                value={last4}
                maxLength={4}
                inputMode="numeric"
                placeholder="1234"
                onChange={(event) => setLast4(event.target.value)}
              />
            </Field>
          </>
        )}
        {error ? (
          <p role="alert" style={fieldErrorStyle}>
            {error}
          </p>
        ) : null}
        <div style={formActionsStyle}>
          <button className="secondary-action" type="button" style={{ flex: 1 }} disabled={submitting} onClick={guardedClose}>
            取消
          </button>
          <button className="primary-action" type="submit" style={{ flex: 1 }} disabled={submitting}>
            {submitting ? "儲存中…" : "儲存"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function CategorySheet({
  existingNames,
  onClose,
  onSubmit,
}: {
  existingNames: string[];
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guardedClose = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("請輸入分類名稱");
      return;
    }
    if (existingNames.includes(trimmed)) {
      setError("已有同名分類，請換一個名稱");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      setError(errorMessage(e)); // 失敗保留全部輸入
      setSubmitting(false);
    }
  };

  return (
    <Sheet title="新增分類" onClose={guardedClose}>
      <form style={formStyle} onSubmit={(event) => void handleSubmit(event)}>
        <Field label="分類名稱">
          <input
            style={inputStyle}
            value={name}
            maxLength={20}
            placeholder="例如：餐廳"
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </Field>
        {error ? (
          <p role="alert" style={fieldErrorStyle}>
            {error}
          </p>
        ) : null}
        <div style={formActionsStyle}>
          <button className="secondary-action" type="button" style={{ flex: 1 }} disabled={submitting} onClick={guardedClose}>
            取消
          </button>
          <button className="primary-action" type="submit" style={{ flex: 1 }} disabled={submitting}>
            {submitting ? "儲存中…" : "儲存"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

interface ConfirmRequest {
  title: string;
  message: string;
  warning?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

function ConfirmSheet({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guardedClose = () => {
    if (!busy) onClose();
  };

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm();
    } catch (e) {
      setError(errorMessage(e)); // 後端拒絕（如 409）就原樣呈現
      setBusy(false);
    }
  };

  return (
    <Sheet title={request.title} onClose={guardedClose}>
      <form style={formStyle} onSubmit={(event) => { event.preventDefault(); void handleConfirm(); }}>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>{request.message}</p>
        {request.warning ? <p style={fieldErrorStyle}>{request.warning}</p> : null}
        {error ? (
          <p role="alert" style={fieldErrorStyle}>
            {error}
          </p>
        ) : null}
        <div style={formActionsStyle}>
          <button className="secondary-action" type="button" style={{ flex: 1 }} disabled={busy} onClick={guardedClose}>
            取消
          </button>
          <button className="primary-action" type="submit" style={dangerActionStyle} disabled={busy}>
            {busy ? "處理中…" : request.confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

type AccountSheetState = { mode: "create" } | { mode: "edit"; account: Account };

export function SettingsPage() {
  const pushToast = useStore((state) => state.pushToast);

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [imports, setImports] = useState<StatementImport[] | null>(null);
  const [importsLoading, setImportsLoading] = useState(true);
  const [importsError, setImportsError] = useState<string | null>(null);

  const [accountSheet, setAccountSheet] = useState<AccountSheetState | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const reloadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      setAccounts(await apiRequest<Account[]>("/accounts"));
    } catch (e) {
      setAccountsError(errorMessage(e));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const reloadCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      setCategories(await apiRequest<CategoryRow[]>("/categories"));
    } catch (e) {
      setCategoriesError(errorMessage(e));
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  const reloadImports = useCallback(async () => {
    setImportsLoading(true);
    setImportsError(null);
    try {
      setImports(await apiRequest<StatementImport[]>("/imports"));
    } catch (e) {
      setImportsError(errorMessage(e));
    } finally {
      setImportsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadAccounts();
    void reloadCategories();
    void reloadImports();
  }, [reloadAccounts, reloadCategories, reloadImports]);

  // 讓總覽／記一筆等其他頁的 store 同步到最新帳戶與分類
  const syncStoreAfterMutation = () => {
    void useStore.getState().loadAccounts();
    void useStore.getState().loadCategories();
  };

  const submitAccount = async (payload: Partial<Account>) => {
    const editing = accountSheet?.mode === "edit" ? accountSheet.account : null;
    if (editing) {
      await apiRequest<Account>(`/accounts/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await apiRequest<Account>("/accounts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    await reloadAccounts();
    syncStoreAfterMutation();
    pushToast("success", editing ? "已更新帳戶" : "已新增帳戶");
    setAccountSheet(null);
  };

  const toggleAccountArchive = async (account: Account) => {
    const nextActive = account.is_active === 0 ? 1 : 0;
    try {
      await apiRequest<Account>(`/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextActive }),
      });
      await reloadAccounts();
      syncStoreAfterMutation();
      pushToast("success", nextActive === 0 ? "已封存帳戶" : "已取消封存");
    } catch (e) {
      pushToast("error", `操作失敗：${errorMessage(e)}`);
    }
  };

  const confirmDeleteAccount = (account: Account) => {
    setConfirmRequest({
      title: `刪除帳戶「${account.nickname}」？`,
      message: "刪除後無法復原。",
      warning:
        account.tx_count > 0
          ? `此帳戶已有 ${account.tx_count} 筆交易，刪除會被拒絕——建議改為封存以保留紀錄。`
          : undefined,
      confirmLabel: "刪除帳戶",
      onConfirm: async () => {
        await apiRequest<void>(`/accounts/${account.id}`, { method: "DELETE" });
        await reloadAccounts();
        syncStoreAfterMutation();
        pushToast("success", "已刪除帳戶");
        setConfirmRequest(null);
      },
    });
  };

  const submitCategory = async (name: string) => {
    await apiRequest<CategoryRow>("/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    await reloadCategories();
    syncStoreAfterMutation();
    pushToast("success", "已新增分類");
    setCategorySheetOpen(false);
  };

  const confirmDeleteCategory = (category: CategoryRow) => {
    const spent = category.spent_minor ?? 0;
    setConfirmRequest({
      title: `刪除分類「${category.name}」？`,
      message: "刪除後無法復原。",
      warning:
        spent > 0
          ? `此分類已有 ${formatMinor(spent)} 的交易紀錄，刪除後這些交易會變成未分類。`
          : undefined,
      confirmLabel: "刪除分類",
      onConfirm: async () => {
        await apiRequest<void>(`/categories/${category.id}`, { method: "DELETE" });
        await reloadCategories();
        syncStoreAfterMutation();
        pushToast("success", "已刪除分類");
        setConfirmRequest(null);
      },
    });
  };

  const accountNicknameById = new Map(
    (accounts ?? []).map((account) => [account.id, account.nickname] as const),
  );

  return (
    <div className="dashboard-content summary-stack">
      <header className="page-heading-row">
        <div>
          <p className="page-kicker">設定</p>
          <h1 className="page-title">設定</h1>
          <p className="page-subtitle">管理帳戶、分類與對帳匯入。</p>
        </div>
      </header>

      <SettingsSection
        eyebrow="更多"
        title="消費地圖與預算"
        titleId="settings-more-title"
        description="次級功能，維持底欄五項乾淨。"
      >
        <div style={exportActionsStyle}>
          <NavLink className="secondary-action" to="/map">
            <MapPin size={17} aria-hidden="true" />
            消費地圖
          </NavLink>
          <NavLink className="secondary-action" to="/budget">
            <WalletCards size={17} aria-hidden="true" />
            預算
          </NavLink>
          <NavLink className="primary-action" to="/setup">
            <WalletCards size={17} aria-hidden="true" />
            Apple Pay 設定
          </NavLink>
        </div>
      </SettingsSection>

      <SettingsSection
        eyebrow="基本設定"
        title="帳戶"
        titleId="settings-accounts-title"
        description="交易會歸屬到帳戶；不再使用的帳戶可封存以保留紀錄。"
        action={
          <button
            className="secondary-action"
            type="button"
            onClick={() => setAccountSheet({ mode: "create" })}
          >
            <Plus size={17} aria-hidden="true" />
            新增帳戶
          </button>
        }
      >
        {accountsLoading && accounts === null ? (
          <SectionSkeleton />
        ) : accounts === null ? (
          <LoadError
            message={`載入失敗：${accountsError ?? "未知錯誤"}`}
            onRetry={() => void reloadAccounts()}
          />
        ) : (
          <>
            {accountsError ? (
              <LoadError
                message={`更新失敗：${accountsError}`}
                onRetry={() => void reloadAccounts()}
              />
            ) : null}
            {accounts.length === 0 ? (
              <InlineHint
                action={
                  <button
                    className="inline-action"
                    type="button"
                    onClick={() => setAccountSheet({ mode: "create" })}
                  >
                    <Plus size={15} aria-hidden="true" />
                    新增帳戶
                  </button>
                }
              >
                還沒有帳戶——新增第一個帳戶以歸屬交易。
              </InlineHint>
            ) : (
              <ul style={listStyle}>
                {accounts.map((account, index) => (
                  <li
                    key={account.id}
                    style={{
                      ...rowStyle,
                      borderBottom:
                        index < accounts.length - 1 ? "1px solid var(--border)" : undefined,
                    }}
                  >
                    <div style={rowMainStyle}>
                      <div style={rowTitleLine}>
                        <span style={rowTitleStyle}>{account.nickname}</span>
                        {account.is_active === 0 ? (
                          <span className="status-badge status-badge--archived">已封存</span>
                        ) : null}
                      </div>
                      <span style={rowMetaStyle}>
                        {ACCOUNT_TYPE_LABEL[account.type] ?? account.type}
                        {account.issuer ? ` · ${account.issuer}` : ""}
                        {account.last4 ? ` ··${account.last4}` : ""}
                        {` · ${account.tx_count} 筆交易`}
                      </span>
                    </div>
                    <strong
                      className="money"
                      style={{
                        ...rowMoneyStyle,
                        color: account.spent_this_month === 0 ? "var(--ink-3)" : undefined,
                      }}
                      title="本月支出"
                    >
                      {formatMinor(account.spent_this_month)}
                    </strong>
                    <div style={rowActionsStyle}>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`編輯帳戶 ${account.nickname}`}
                        onClick={() => setAccountSheet({ mode: "edit", account })}
                      >
                        <Pencil size={18} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={
                          account.is_active === 0
                            ? `取消封存帳戶 ${account.nickname}`
                            : `封存帳戶 ${account.nickname}`
                        }
                        onClick={() => void toggleAccountArchive(account)}
                      >
                        {account.is_active === 0 ? (
                          <ArchiveRestore size={18} aria-hidden="true" />
                        ) : (
                          <Archive size={18} aria-hidden="true" />
                        )}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`刪除帳戶 ${account.nickname}`}
                        onClick={() => confirmDeleteAccount(account)}
                      >
                        <Trash2 size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        eyebrow="消費分類"
        title="分類"
        titleId="settings-categories-title"
        description="自訂消費分類，讓流水與預算更好整理。"
        action={
          <button
            className="secondary-action"
            type="button"
            onClick={() => setCategorySheetOpen(true)}
          >
            <Plus size={17} aria-hidden="true" />
            新增分類
          </button>
        }
      >
        {categoriesLoading && categories === null ? (
          <SectionSkeleton />
        ) : categories === null ? (
          <LoadError
            message={`載入失敗：${categoriesError ?? "未知錯誤"}`}
            onRetry={() => void reloadCategories()}
          />
        ) : (
          <>
            {categoriesError ? (
              <LoadError
                message={`更新失敗：${categoriesError}`}
                onRetry={() => void reloadCategories()}
              />
            ) : null}
            {categories.length === 0 ? (
              <InlineHint
                action={
                  <button
                    className="inline-action"
                    type="button"
                    onClick={() => setCategorySheetOpen(true)}
                  >
                    <Plus size={15} aria-hidden="true" />
                    新增分類
                  </button>
                }
              >
                還沒有分類——新增分類讓交易更好整理。
              </InlineHint>
            ) : (
              <ul style={listStyle}>
                {categories.map((category, index) => {
                  const spent = category.spent_minor ?? 0;
                  return (
                    <li
                      key={category.id}
                      style={{
                        ...rowStyle,
                        borderBottom:
                          index < categories.length - 1 ? "1px solid var(--border)" : undefined,
                      }}
                    >
                      <div style={rowMainStyle}>
                        <span style={rowTitleStyle}>{category.name}</span>
                        <span style={rowMetaStyle}>
                          {spent > 0 ? "已有交易，刪除後會變成未分類" : "尚無交易"}
                        </span>
                      </div>
                      <strong
                        className="money"
                        style={{
                          ...rowMoneyStyle,
                          color: spent === 0 ? "var(--ink-3)" : undefined,
                        }}
                        title="已確認消費"
                      >
                        {formatMinor(spent)}
                      </strong>
                      <div style={rowActionsStyle}>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`刪除分類 ${category.name}`}
                          onClick={() => confirmDeleteCategory(category)}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        eyebrow="對帳匯入"
        title="匯入"
        titleId="settings-imports-title"
        description="對帳單匯入的歷史紀錄（唯讀）。"
      >
        {importsLoading && imports === null ? (
          <SectionSkeleton />
        ) : imports === null ? (
          <LoadError
            message={`載入失敗：${importsError ?? "未知錯誤"}`}
            onRetry={() => void reloadImports()}
          />
        ) : (
          <>
            {importsError ? (
              <LoadError
                message={`更新失敗：${importsError}`}
                onRetry={() => void reloadImports()}
              />
            ) : null}
            {imports.length === 0 ? (
              <InlineHint>尚無匯入紀錄——對帳單匯入後會顯示在這裡。</InlineHint>
            ) : (
              <ul style={listStyle}>
                {imports.map((item, index) => {
                  // 後端 CHECK 限定四種狀態；?? 僅防禦未知值
                  const meta: { label: string; className?: string } =
                    IMPORT_STATUS_META[item.import_status] ?? { label: item.import_status };
                  const parts = [
                    item.statement_period || null,
                    accountNicknameById.get(item.funding_account_id) ?? null,
                    `${item.imported_count ?? 0} 筆`,
                    item.created_at ? item.created_at.slice(0, 10) : null,
                  ].filter((part): part is string => Boolean(part));
                  return (
                    <li
                      key={item.id}
                      style={{
                        ...rowStyle,
                        borderBottom:
                          index < imports.length - 1 ? "1px solid var(--border)" : undefined,
                      }}
                    >
                      <div style={rowMainStyle}>
                        <div style={rowTitleLine}>
                          <span style={rowTitleStyle}>
                            {item.file_path.split("/").pop() || item.file_path}
                          </span>
                          <span className={`status-badge ${meta.className ?? ""}`}>
                            {meta.label}
                          </span>
                        </div>
                        <span style={rowMetaStyle}>
                          {parts.length > 0 ? parts.join(" · ") : "—"}
                        </span>
                        {item.import_status === "failed" && item.error_log ? (
                          <span style={{ ...rowMetaStyle, color: "var(--error)" }}>
                            {item.error_log}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        eyebrow="資料備份"
        title="匯出資料"
        titleId="settings-export-title"
        description="將目前所有交易匯出成檔案，可用於備份或匯入其他工具。"
      >
        <div style={exportActionsStyle}>
          {EXPORT_FORMATS.map(({ format, label }) => (
            <button
              key={format}
              className="secondary-action"
              type="button"
              onClick={() => openExport(format)}
            >
              <Download size={17} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </SettingsSection>

      {accountSheet ? (
        <AccountSheet
          key={accountSheet.mode === "edit" ? accountSheet.account.id : "create"}
          account={accountSheet.mode === "edit" ? accountSheet.account : null}
          onClose={() => setAccountSheet(null)}
          onSubmit={submitAccount}
        />
      ) : null}

      {categorySheetOpen ? (
        <CategorySheet
          existingNames={(categories ?? []).map((category) => category.name.trim())}
          onClose={() => setCategorySheetOpen(false)}
          onSubmit={submitCategory}
        />
      ) : null}

      {confirmRequest ? (
        <ConfirmSheet request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      ) : null}
    </div>
  );
}
