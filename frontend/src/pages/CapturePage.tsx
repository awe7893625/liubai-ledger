// CapturePage — 任務 C：上半快速記帳表單，下半 Inbox 待分類清單。
// 樣式沿用 App.tsx / styles.css 既有 class 與 CSS 變數；新結構僅以 inline style 補版面。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { api } from "../api";
import type { Account, Category, Transaction } from "../types";
import { flowMoneyClass } from "../utils/money";
import { useStore } from "../store/useStore";
import type { LoadState } from "../store/useStore";

// Inbox 端點尚未進 api client（本票只允許動 CapturePage.tsx），在此沿用同一個 BASE 慣例。
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function inboxRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, `API ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Inbox 待分類項目＝email_events 列（只宣告 UI 用到的欄位）。 */
type InboxItem = {
  id: string;
  source: string;
  subject: string | null;
  event_type: string;
  received_at: string;
  parsed_json: string;
  needs_review: number;
};

type ParsedEvent = {
  amountMinor: number | null;
  merchant: string | null;
  date: string | null;
};

function parseEvent(raw: string | null | undefined): ParsedEvent {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = {};
  }
  const amountRaw = data.amount_minor ?? data.amount;
  const amountNumber =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string"
        ? Number(amountRaw)
        : Number.NaN;
  // 後端 resolve 拒收 0／非整數金額，這裡同步視為「無法入帳」。
  const amountMinor =
    Number.isFinite(amountNumber) && amountNumber !== 0
      ? Math.round(amountNumber)
      : null;
  const merchant =
    typeof data.merchant === "string" && data.merchant.trim()
      ? data.merchant.trim()
      : null;
  const dateRaw =
    typeof data.date === "string"
      ? data.date
      : typeof data.occurred_at === "string"
        ? data.occurred_at
        : null;
  const date =
    dateRaw && /^\d{4}-\d{2}-\d{2}/.test(dateRaw) ? dateRaw.slice(0, 10) : null;
  return { amountMinor, merchant, date };
}

const ntFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 2,
});

function formatNt(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  return `NT$${ntFormatter.format(Math.abs(minor) / 100)}`;
}

function formatSignedNt(minor: number): string {
  if (!Number.isFinite(minor) || minor === 0) return formatNt(minor);
  return `${minor < 0 ? "−" : "+"}${formatNt(minor)}`;
}

function errText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "未知錯誤";
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const LAST_ACCOUNT_KEY = "ledger.capture.lastAccountId";

function readLastAccountId(): string | null {
  try {
    return window.localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

function saveLastAccountId(id: string): void {
  try {
    window.localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    /* private mode 等，忽略 */
  }
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  payment: "付款",
  refund: "退款",
  income: "收入",
  transfer: "轉帳",
  unknown: "其他",
};

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

// ---- 小元件（皆只用既有 class ＋ inline 版面） ----

const labelStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "0.75rem",
  fontWeight: 650,
};

const mutedStyle: CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: "0.8rem",
};

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return htmlFor ? (
    <label htmlFor={htmlFor} style={labelStyle}>
      {children}
    </label>
  ) : (
    <span style={labelStyle}>{children}</span>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="capture-field">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {error ? (
        <p role="alert" style={{ color: "var(--error)", fontSize: "0.75rem", fontWeight: 600 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  hint,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  hint?: string | null;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="chip-btn"
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {label}
      {hint ? <span className="chip-hint">{hint}</span> : null}
    </button>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="capture-chip-row" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof CheckCircle2;
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
    </div>
  );
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="error-card error-card--compact" role="alert">
      <div className="error-icon" aria-hidden="true">
        <AlertCircle size={22} strokeWidth={1.8} />
      </div>
      <div className="error-copy">
        <h2>載入失敗</h2>
        <p>{message}</p>
      </div>
      <button className="secondary-action" type="button" onClick={onRetry}>
        <RefreshCcw size={16} aria-hidden="true" />
        重試
      </button>
    </section>
  );
}

function InlineRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
      <span style={{ ...mutedStyle, color: "var(--error)" }}>{message}</span>
      <button className="text-action" type="button" onClick={onRetry}>
        <RefreshCcw size={14} aria-hidden="true" />
        重試
      </button>
    </div>
  );
}

// ---- 快速記帳表單 ----

type Direction = "expense" | "income";
type FieldErrors = { amount?: string; account?: string };

// ---- AI 助理卡：照片辨識 / 語音輸入 → 帶入表單 ----

function CaptureForm({
  categories,
  categoriesState,
  accounts,
  accountsState,
  onRetryCategories,
  onRetryAccounts,
}: {
  categories: Category[] | null;
  categoriesState: LoadState;
  accounts: Account[] | null;
  accountsState: LoadState;
  onRetryCategories: () => void;
  onRetryAccounts: () => void;
}) {
  const pushToast = useStore((s) => s.pushToast);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const [direction, setDirection] = useState<Direction>("expense");
  const [amountText, setAmountText] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState(() => todayLocal());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  // 帳戶預設：上次用 → 第一個啟用帳戶 → 第一個帳戶。
  useEffect(() => {
    if (accountId !== null || !accounts) return;
    const stored = readLastAccountId();
    const storedMatch = stored ? accounts.find((a) => a.id === stored) : undefined;
    const initial =
      storedMatch ?? accounts.find((a) => a.is_active === 1) ?? accounts[0] ?? null;
    setAccountId(initial ? initial.id : null);
  }, [accounts, accountId]);

  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active === 1),
    [categories],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const cleaned = amountText.replace(/[,\s，]/g, "");
    const errors: FieldErrors = {};
    let amountMinor: number | null = null;
    if (!cleaned) {
      errors.amount = "請輸入金額";
    } else if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      errors.amount = "金額格式不正確（例：120 或 120.5）";
    } else {
      const minor = Math.round(Number(cleaned) * 100);
      if (minor <= 0) errors.amount = "金額必須大於 0";
      else amountMinor = minor;
    }
    if (!accountId) {
      errors.account =
        accounts && accounts.length > 0
          ? "請選擇帳戶"
          : "尚無帳戶，請先於設定頁新增帳戶";
    }
    setFieldErrors(errors);
    setFormError(null);
    if (errors.amount || errors.account || amountMinor === null || !accountId) return;

    setSubmitting(true);
    try {
      const created = await api.createTransaction({
        funding_account_id: accountId,
        // amount 負＝支出、正＝收入（minor units）
        amount: direction === "expense" ? -amountMinor : amountMinor,
        currency: "TWD",
        date: dateStr,
        description: notes.trim() ? notes.trim() : null,
        category_id: categoryId,
        source: "manual",
        status: "confirmed",
      });
      saveLastAccountId(accountId);
      pushToast("success", `已記錄 ${formatNt(created.amount)}`);
      // 重置可連記：清掉每次會變動的欄位，保留方向／帳戶／日期。
      setAmountText("");
      setCategoryId(null);
      setNotes("");
      setFieldErrors({});
      setFormError(null);
      amountInputRef.current?.focus();
    } catch (err) {
      // 失敗：保留全部輸入，行內提示。
      setFormError(`記錄失敗：${errText(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const accountsReady = accountsState.status === "loaded" && accounts !== null;
  const noAccounts = accountsReady && accounts.length === 0;
  const submitDisabled = submitting || noAccounts || !accountId;

  return (
    <section className="card capture-card" aria-labelledby="capture-form-title">
      <div className="card-heading capture-card-heading">
        <div>
          <p className="section-eyebrow">手動輸入</p>
          <h2 className="section-title" id="capture-form-title">
            快速記一筆
          </h2>
          <p className="section-description">金額、分類、帳戶，三秒完成。</p>
        </div>
      </div>

      {accountsState.status === "error" ? (
        <ErrorBlock message={accountsState.error ?? "無法取得帳戶。"} onRetry={onRetryAccounts} />
      ) : null}

      <form className="capture-form" onSubmit={handleSubmit} noValidate>
        <div className="capture-segment" role="group" aria-label="記帳類型">
          {(["expense", "income"] as const).map((key) => {
            const selected = direction === key;
            const Icon = key === "expense" ? ArrowDownRight : ArrowUpRight;
            return (
              <button
                key={key}
                className="capture-segment-btn"
                data-direction={key}
                type="button"
                aria-pressed={selected}
                onClick={() => setDirection(key)}
              >
                <Icon size={17} aria-hidden="true" />
                {key === "expense" ? "支出" : "收入"}
              </button>
            );
          })}
        </div>

        <Field label="金額（NT$）" htmlFor="capture-amount" error={fieldErrors.amount}>
          <input
            id="capture-amount"
            ref={amountInputRef}
            className={`money capture-input capture-amount-input${direction === "income" ? " is-income" : ""}`}
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            autoFocus
            value={amountText}
            placeholder="0"
            aria-label="金額"
            onChange={(e) => {
              setAmountText(e.target.value);
              setFieldErrors((prev) => (prev.amount ? { ...prev, amount: undefined } : prev));
            }}
          />
        </Field>

        <div className="capture-choice-group">
          <FieldLabel>分類</FieldLabel>
          {categoriesState.status === "loading" ? (
            <span style={mutedStyle}>載入中…</span>
          ) : categoriesState.status === "error" ? (
            <InlineRetry message="分類載入失敗" onRetry={onRetryCategories} />
          ) : activeCategories.length === 0 ? (
            <span style={mutedStyle}>尚無分類，可先不分類直接記。</span>
          ) : (
            <ChipRow label="選擇分類">
              {activeCategories.map((category) => (
                <Chip
                  key={category.id}
                  label={category.name}
                  selected={category.id === categoryId}
                  onSelect={() => setCategoryId(category.id)}
                />
              ))}
            </ChipRow>
          )}
        </div>

        <div className="capture-choice-group">
          <FieldLabel>帳戶</FieldLabel>
          {accountsState.status === "loading" ? (
            <span style={mutedStyle}>載入中…</span>
          ) : noAccounts ? (
            <span style={{ ...mutedStyle, color: "var(--warning)" }}>
              尚無帳戶，請先於設定頁新增帳戶。
            </span>
          ) : (
            <ChipRow label="選擇帳戶">
              {(accounts ?? []).map((account) => (
                <Chip
                  key={account.id}
                  label={account.nickname}
                  hint={account.last4 ? `··${account.last4}` : null}
                  selected={account.id === accountId}
                  onSelect={() => {
                    setAccountId(account.id);
                    setFieldErrors((prev) =>
                      prev.account ? { ...prev, account: undefined } : prev,
                    );
                  }}
                />
              ))}
            </ChipRow>
          )}
          {fieldErrors.account ? (
            <p role="alert" className="capture-field-error">
              {fieldErrors.account}
            </p>
          ) : null}
        </div>

        <div className="capture-detail-grid">
          <Field label="日期" htmlFor="capture-date">
            <input
              id="capture-date"
              className="capture-input"
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
          </Field>

          <Field label="備註" htmlFor="capture-notes">
            <input
              id="capture-notes"
              className="capture-input"
              type="text"
              value={notes}
              placeholder="選填"
              autoComplete="off"
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>

        {formError ? (
          <p role="alert" className="capture-form-error">
            {formError}
          </p>
        ) : null}

        <button
          className="primary-action capture-submit"
          type="submit"
          disabled={submitDisabled}
        >
          {submitting ? (
            "記錄中…"
          ) : (
            <>
              <Plus size={19} aria-hidden="true" />
              記一筆
            </>
          )}
        </button>
      </form>
    </section>
  );
}

// ---- Inbox 待分類清單 ----

function InboxCard({
  item,
  categories,
  categoriesState,
  pick,
  busy,
  onPick,
  onRetryCategories,
  onResolve,
  onDismiss,
}: {
  item: InboxItem;
  categories: Category[] | null;
  categoriesState: LoadState;
  pick: string | null;
  busy: boolean;
  onPick: (categoryId: string) => void;
  onRetryCategories: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const parsed = useMemo(() => parseEvent(item.parsed_json), [item.parsed_json]);
  const subject = item.subject?.trim() || parsed.merchant || "（無主旨）";
  const dateLabel = parsed.date ?? item.received_at.slice(0, 10);
  const amountMinor = parsed.amountMinor;
  const canResolve = Boolean(pick) && amountMinor !== null && !busy;
  const activeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.is_active === 1),
    [categories],
  );

  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
        padding: "var(--space-lg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
      }}
    >
      <div className="transaction-row" style={{ minHeight: 0 }}>
        <div className="transaction-main">
          <div className="transaction-title-row">
            <h3 className="transaction-title">{subject}</h3>
            {item.needs_review === 1 ? (
              <span className="status-badge status-badge--pending">
                <Clock3 size={14} strokeWidth={1.9} aria-hidden="true" />
                建議核對
              </span>
            ) : null}
          </div>
          <div className="transaction-meta">
            <span>{item.source?.trim() || "未知來源"}</span>
            <span>{eventTypeLabel(item.event_type)}</span>
            <time dateTime={dateLabel}>{dateLabel}</time>
          </div>
        </div>
        <strong className={`transaction-amount ${flowMoneyClass(amountMinor)}`}>
          {amountMinor === null ? "—" : formatSignedNt(amountMinor)}
        </strong>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <FieldLabel>分類</FieldLabel>
        {categoriesState.status === "loading" ? (
          <span style={mutedStyle}>載入中…</span>
        ) : categoriesState.status === "error" ? (
          <InlineRetry message="分類載入失敗" onRetry={onRetryCategories} />
        ) : activeCategories.length === 0 ? (
          <span style={{ ...mutedStyle, color: "var(--warning)" }}>
            尚無分類可選，請先於設定頁新增分類。
          </span>
        ) : (
          <ChipRow label="選擇分類以入帳">
            {activeCategories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={category.id === pick}
                disabled={busy}
                onSelect={() => onPick(category.id)}
              />
            ))}
          </ChipRow>
        )}
      </div>

      <div style={{ display: "flex", gap: "var(--space-sm)" }}>
        <button
          className="primary-action"
          type="button"
          disabled={!canResolve}
          onClick={onResolve}
          title={canResolve ? "入帳為已確認交易" : "請先選擇分類"}
          style={{ flex: 1, opacity: canResolve ? 1 : 0.6, cursor: canResolve ? "pointer" : "default" }}
        >
          {busy ? "處理中…" : "入帳"}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          onClick={onDismiss}
          style={{ flex: 1 }}
        >
          忽略
        </button>
      </div>

      {amountMinor === null ? (
        <p style={{ color: "var(--warning)", fontSize: "0.75rem", fontWeight: 600 }}>
          缺少可解析的金額，無法入帳；確認無誤可忽略。
        </p>
      ) : !pick ? (
        <p style={mutedStyle}>選擇分類後即可入帳。</p>
      ) : null}
    </li>
  );
}

function InboxSection({
  items,
  inboxState,
  categories,
  categoriesState,
  picks,
  busyId,
  onPick,
  onRetryInbox,
  onRetryCategories,
  onResolve,
  onDismiss,
}: {
  items: InboxItem[] | null;
  inboxState: LoadState;
  categories: Category[] | null;
  categoriesState: LoadState;
  picks: Record<string, string>;
  busyId: string | null;
  onPick: (itemId: string, categoryId: string) => void;
  onRetryInbox: () => void;
  onRetryCategories: () => void;
  onResolve: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
}) {
  return (
    <section
      className="card"
      aria-labelledby="inbox-title"
      aria-busy={inboxState.status === "loading"}
    >
      <div className="card-heading">
        <div>
          <p className="section-eyebrow">自動解析</p>
          <h2 className="section-title" id="inbox-title">
            收納匣
          </h2>
          <p className="section-description">
            信件與 Telegram 自動解析的待分類項目，選分類後入帳即計入當月預算。
          </p>
        </div>
        {items && items.length > 0 ? (
          <span className="section-meta">{items.length} 筆待處理</span>
        ) : null}
      </div>

      {inboxState.status === "error" ? (
        <ErrorBlock message={inboxState.error ?? "無法取得收納匣。"} onRetry={onRetryInbox} />
      ) : inboxState.status === "loading" ? (
        <p className="loading-copy">正在載入收納匣…</p>
      ) : items && items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="已全部處理完畢 ✓"
          description="待分類項目都清空了，新的信件或 Telegram 事件會自動出現在這裡。"
        />
      ) : (
        <ul
          className="transactions-list"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}
        >
          {(items ?? []).map((item) => (
            <InboxCard
              key={item.id}
              item={item}
              categories={categories}
              categoriesState={categoriesState}
              pick={picks[item.id] ?? null}
              busy={busyId === item.id}
              onPick={(categoryId) => onPick(item.id, categoryId)}
              onRetryCategories={onRetryCategories}
              onResolve={() => onResolve(item)}
              onDismiss={() => onDismiss(item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- 頁面 ----

export function CapturePage() {
  const pushToast = useStore((s) => s.pushToast);

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesState, setCategoriesState] = useState<LoadState>({ status: "loading" });
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsState, setAccountsState] = useState<LoadState>({ status: "loading" });

  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  const [inboxState, setInboxState] = useState<LoadState>({ status: "loading" });
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsState({ status: "loading" });
    try {
      const rows = await api.listAccounts();
      setAccounts(rows);
      setAccountsState({ status: "loaded" });
    } catch (err) {
      setAccountsState({ status: "error", error: errText(err) });
    }
  }, []);

  const loadCategories = useCallback(async () => {
    setCategoriesState({ status: "loading" });
    try {
      const rows = await api.listCategories();
      setCategories(rows);
      setCategoriesState({ status: "loaded" });
    } catch (err) {
      setCategoriesState({ status: "error", error: errText(err) });
    }
  }, []);

  const loadInbox = useCallback(async () => {
    setInboxState({ status: "loading" });
    try {
      const rows = await inboxRequest<InboxItem[]>("/inbox?status=open");
      setInbox(rows);
      setInboxState({ status: "loaded" });
    } catch (err) {
      setInbox(null);
      setInboxState({ status: "error", error: errText(err) });
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadCategories();
    void loadInbox();
  }, [loadAccounts, loadCategories, loadInbox]);

  const handlePick = useCallback((itemId: string, categoryId: string) => {
    setPicks((prev) => ({ ...prev, [itemId]: categoryId }));
  }, []);

  const handleResolve = useCallback(
    async (item: InboxItem) => {
      const categoryId = picks[item.id];
      if (!categoryId || busyId) return;
      setBusyId(item.id);
      try {
        const created = await inboxRequest<Transaction>(`/inbox/${item.id}/resolve`, {
          method: "POST",
          body: JSON.stringify({ category_id: categoryId }),
        });
        setInbox((prev) => (prev ? prev.filter((row) => row.id !== item.id) : prev));
        setPicks((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        pushToast("success", `已入帳 ${formatNt(created.amount)}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setInbox((prev) => (prev ? prev.filter((row) => row.id !== item.id) : prev));
          pushToast("info", "此項目已於其他畫面處理完畢");
        } else {
          pushToast("error", `入帳失敗：${errText(err)}`);
        }
      } finally {
        setBusyId(null);
      }
    },
    [busyId, picks, pushToast],
  );

  const handleDismiss = useCallback(
    async (item: InboxItem) => {
      if (busyId) return;
      setBusyId(item.id);
      try {
        await inboxRequest<{ id: string; inbox_status: string }>(
          `/inbox/${item.id}/dismiss`,
          { method: "POST" },
        );
        setInbox((prev) => (prev ? prev.filter((row) => row.id !== item.id) : prev));
        setPicks((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        pushToast("info", "已忽略 1 筆待分類項目");
      } catch (err) {
        pushToast("error", `忽略失敗：${errText(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [busyId, pushToast],
  );

  return (
    <div className="dashboard-content capture-page">
      <header className="capture-page-head">
        <p className="page-kicker">記一筆</p>
        <h1 className="page-title">記一筆</h1>
        <p className="page-subtitle">快速記帳，順手消化待分類收納匣。</p>
      </header>
      <div className="capture-stack">
        <CaptureForm
          categories={categories}
          categoriesState={categoriesState}
          accounts={accounts}
          accountsState={accountsState}
          onRetryCategories={() => void loadCategories()}
          onRetryAccounts={() => void loadAccounts()}
        />
        <InboxSection
          items={inbox}
          inboxState={inboxState}
          categories={categories}
          categoriesState={categoriesState}
          picks={picks}
          busyId={busyId}
          onPick={handlePick}
          onRetryInbox={() => void loadInbox()}
          onRetryCategories={() => void loadCategories()}
          onResolve={(item) => void handleResolve(item)}
          onDismiss={(item) => void handleDismiss(item)}
        />
      </div>
    </div>
  );
}
