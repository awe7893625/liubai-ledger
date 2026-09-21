// LedgerPage — 流水頁
// Sticky 篩選列（月份／帳戶／狀態）＋ 依日期分組清單 ＋ 編輯 bottom sheet。
// 本頁專屬樣式以 `lp-` 前綴收在 styles.css；chip／bottom sheet 走共用樣式。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Receipt,
  RefreshCcw,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../api";
import type { Account, Category, Transaction, TxSource, TxStatus } from "../types";
import { flowMoneyClass, totalMoneyClass } from "../utils/money";
import { toTaipeiTime, toTaipeiDate } from "../utils/datetime";
import { useStore } from "../store/useStore";
import { MonthSwitcher, formatMonthLabel } from "../components/MonthSwitcher";

/** Backend list/detail responses join category + account names onto the row. */
type LedgerTransaction = Transaction & {
  category_name?: string | null;
  account_nickname?: string | null;
};

type ListStatus = "loading" | "loaded" | "error";

const PAGE_SIZE = 200; // 一次撈足整月（單月最多~120筆），不再分段按
const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

const STATUS_META: Record<TxStatus, { label: string; icon: LucideIcon }> = {
  pending: { label: "待確認", icon: Clock3 },
  confirmed: { label: "已確認", icon: CheckCircle2 },
  archived: { label: "已封存", icon: Receipt },
  duplicate: { label: "疑似重複", icon: SearchX },
};

/** 資料來源標示：交易從哪條線進來的（Apple Pay 捷徑／Email／簡訊／人工…）。 */
const SOURCE_META: Record<TxSource, { label: string }> = {
  capture: { label: "Apple Pay" },
  email: { label: "Email" },
  sms: { label: "簡訊" },
  statement: { label: "對帳單" },
  manual: { label: "人工" },
  telegram: { label: "Telegram" },
  sync: { label: "同步" },
};

function SourceBadge({ source }: { source: TxSource | string }) {
  const meta = SOURCE_META[source as TxSource];
  if (!meta) return null;
  return (
    <span className={`source-badge source-badge--${source}`} aria-label={`資料來源：${meta.label}`}>
      {meta.label}
    </span>
  );
}

const moneyFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 支出帶負號、收入帶加號（顏色由呼叫端掛 flowMoneyClass）。 */
function formatSignedMoney(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  if (minor === 0) return `NT$${moneyFormatter.format(0)}`;
  const sign = minor < 0 ? "−" : "+";
  return `${sign}NT$${moneyFormatter.format(Math.abs(minor) / 100)}`;
}

function formatDayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${Number(match[2])}月${Number(match[3])}日 ${WEEKDAYS[day.getDay()] ?? ""}`;
}

/** 金額輸入（元）→ minor units；格式不合回 null。 */
function dollarsToMinor(input: string): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="chip-btn"
      type="button"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: TxStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`status-badge status-badge--${status}`}>
      <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function parseWalletLocation(notes: string | null | undefined): string | null {
  if (!notes || !notes.includes("📍")) return null;
  const afterPin = notes.slice(notes.indexOf("📍") + "📍".length);
  const locSep = afterPin.indexOf(" · ");
  const locationName = (locSep === -1 ? afterPin : afterPin.slice(0, locSep)).trim();
  const prefix = "apple_pay · ";
  const prefixAt = notes.indexOf(prefix);
  let timeSource = "";
  if (prefixAt !== -1) {
    const afterPrefix = notes.slice(prefixAt + prefix.length);
    const srcSep = afterPrefix.indexOf(" · ");
    timeSource = (srcSep === -1 ? afterPrefix : afterPrefix.slice(0, srcSep)).trim();
  }
  if (timeSource) return `📍${locationName} · Apple Pay(${timeSource})`;
  return `📍${locationName}`;
}

function TxRow({
  tx,
  onOpen,
}: {
  tx: LedgerTransaction;
  onOpen: () => void;
}) {
  const category = tx.category_name?.trim() || "未分類";
  const catId = tx.category_id ?? "c_other";
  const note = tx.merchant?.trim() || tx.description?.trim() || "";
  const title = note || category;
  const walletLocation = parseWalletLocation(tx.notes);
  const accountName = tx.account_nickname?.trim() || "未指定帳戶";
  const timeLabel = tx.occurred_at ? toTaipeiTime(tx.occurred_at) : "";
  // note 為空時標題已經是分類名，meta 就不要再重複一次
  const metaText = [timeLabel, title === category ? "" : category, accountName, walletLocation]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="lp-tx-item">
      <button
        className="lp-tx-row"
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`${category} ${formatSignedMoney(tx.amount)}，點一下編輯`}
      >
        <span className="lp-tx-row-dot">
          <span className="lp-cat-dot" data-cat={catId} aria-hidden="true" />
        </span>
        <span className="lp-tx-main">
          <span className="lp-tx-title-row">
            <span className="lp-tx-title">{title}</span>
            <SourceBadge source={tx.source} />
            {tx.status !== "confirmed" ? <StatusBadge status={tx.status} /> : null}
          </span>
          <span className="lp-tx-meta">{metaText}</span>
        </span>
        <span
          className={`lp-tx-amount ${
            tx.amount < 0 ? "is-expense" : tx.amount > 0 ? "is-income" : ""
          }`}
        >
          {formatSignedMoney(tx.amount)}
        </span>
      </button>
    </li>
  );
}

function SkeletonList() {
  return (
    <div className="lp-skel" aria-busy="true" aria-label="正在載入交易">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="lp-skel-row" key={index}>
          <div className="lp-skel-main">
            <div className="skeleton lp-skel-title" />
            <div className="skeleton lp-skel-meta" />
          </div>
          <div className="skeleton lp-skel-amount" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

function LoadErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="error-card" role="alert">
      <div className="error-icon" aria-hidden="true">
        <AlertCircle size={22} strokeWidth={1.8} />
      </div>
      <div className="error-copy">
        <h2>載入失敗</h2>
        <p>目前無法取得交易資料，請稍後再試。</p>
      </div>
      <button className="secondary-action" type="button" onClick={onRetry}>
        <RefreshCcw size={16} aria-hidden="true" />
        重試
      </button>
    </section>
  );
}

type SheetPatch = {
  amount: number;
  date: string;
  funding_account_id: string;
  category_id: string | null;
  status: TxStatus;
  description: string;
  notes: string;
};

function EditSheet({
  tx,
  categoryOptions,
  accountOptions,
  onClose,
  onSave,
  onDelete,
}: {
  tx: LedgerTransaction;
  categoryOptions: { id: string; name: string }[];
  accountOptions: { id: string; nickname: string }[];
  onClose: () => void;
  onSave: (patch: SheetPatch) => void;
  onDelete: () => void;
}) {
  const [kind, setKind] = useState<"expense" | "income">(
    tx.amount < 0 ? "expense" : "income",
  );
  const [amountText, setAmountText] = useState(() =>
    (Math.abs(tx.amount) / 100).toFixed(2),
  );
  const [date, setDate] = useState(tx.date);
  const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
  const [accountId, setAccountId] = useState(tx.funding_account_id || "unknown");
  const [status, setStatus] = useState<TxStatus>(tx.status);
  const [description, setDescription] = useState(tx.description ?? "");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 系統自動帶的 meta（apple_pay · shortcut_trigger · raw_card=…）不讓使用者看到原始碼
  const isSystemNotes = /^(apple_pay|sms|email) · /.test(tx.notes ?? "");
  const [notesTouched, setNotesTouched] = useState(!isSystemNotes);
  const systemNoteLabel = (() => {
    const n = tx.notes ?? "";
    if (n.includes("shortcut_trigger")) return "手機捷徑自動記錄（Apple Pay 拍卡）";
    if (n.startsWith("email · ")) return "銀行 Email 自動匯入";
    if (n.startsWith("sms · ")) return "銀行簡訊自動匯入";
    if (n.startsWith("apple_pay · ")) return "Apple Pay 捷徑自動記錄";
    return "系統自動記錄";
  })();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const dateTimeStr = tx.occurred_at
    ? `${toTaipeiDate(tx.occurred_at)} ${toTaipeiTime(tx.occurred_at)}`
    : tx.date;
  const metaLine = [
    dateTimeStr,
    tx.account_nickname?.trim() || "未指定帳戶",
    tx.merchant?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const submit = () => {
    const minor = dollarsToMinor(amountText);
    if (minor === null || minor <= 0) {
      setError("請輸入有效金額（大於 0）");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("請輸入有效日期");
      return;
    }
    onSave({
      amount: kind === "expense" ? -minor : minor,
      date,
      funding_account_id: accountId,
      category_id: categoryId || null,
      status,
      description: description.trim(),
      notes: notes.trim(),
    });
  };

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="編輯交易"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="lp-sheet-head">
          <div>
            <h2 className="lp-sheet-title">編輯交易</h2>
            <p className="lp-sheet-meta">{metaLine}</p>
            <NavLink className="text-action" to={`/assistant?tx=${tx.id}`}>
              <Sparkles size={14} aria-hidden="true" />
              問助理
            </NavLink>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="關閉"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="lp-seg" role="group" aria-label="收支類別">
          <button
            className="lp-seg-exp"
            type="button"
            aria-pressed={kind === "expense"}
            onClick={() => setKind("expense")}
          >
            支出
          </button>
          <button
            className="lp-seg-inc"
            type="button"
            aria-pressed={kind === "income"}
            onClick={() => setKind("income")}
          >
            收入
          </button>
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-amount">
            金額（{kind === "expense" ? "支出" : "收入"}）
          </label>
          <input
            id="lp-amount"
            className="lp-input lp-input--amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(event) => {
              setAmountText(event.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
          />
          {error ? <p className="lp-field-error" role="alert">{error}</p> : null}
        </div>

        <div className="lp-field lp-field--split">
          <label className="lp-label" htmlFor="lp-date">
            日期
          </label>
          <input
            id="lp-date"
            className="lp-input"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setError(null);
            }}
          />
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-account">
            帳戶
          </label>
          <select
            id="lp-account"
            className="lp-select"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">未指定帳戶</option>
            {accountOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.nickname}
              </option>
            ))}
          </select>
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-category">
            分類
          </label>
          <select
            id="lp-category"
            className="lp-select"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">未分類</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-status">
            狀態
          </label>
          <select
            id="lp-status"
            className="lp-select"
            value={status}
            onChange={(event) => setStatus(event.target.value as TxStatus)}
          >
            {(Object.keys(STATUS_META) as TxStatus[]).map((value) => (
              <option key={value} value={value}>
                {STATUS_META[value].label}
              </option>
            ))}
          </select>
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-description">
            描述（商家・項目名稱）
          </label>
          <input
            id="lp-description"
            className="lp-input"
            type="text"
            value={description}
            placeholder="例如：Ti Wu Chi 午餐"
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="lp-field">
          <label className="lp-label" htmlFor="lp-notes">
            備注
          </label>
          {isSystemNotes && !notesTouched ? (
            <div className="lp-system-note" aria-label="系統記錄來源">
              <span className="lp-system-note-badge">自動</span>
              {systemNoteLabel}
              <button
                type="button"
                className="lp-system-note-edit"
                onClick={() => setNotesTouched(true)}
              >
                編輯
              </button>
            </div>
          ) : (
            <textarea
              id="lp-notes"
              className="lp-input"
              rows={3}
              value={notes}
              placeholder="詳細備注（可留空）"
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </div>

        {confirmDelete ? (
          <div className="lp-confirm">
            <span>確認刪除這筆交易？此操作無法復原。</span>
            <button
              className="lp-btn-danger"
              type="button"
              onClick={onDelete}
            >
              <Trash2 size={16} aria-hidden="true" />
              確認刪除
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <div className="lp-sheet-foot">
            <button
              className="lp-btn-danger"
              type="button"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} aria-hidden="true" />
              刪除
            </button>
            <button className="primary-action" type="button" onClick={submit}>
              儲存
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LedgerPage() {
  const pushToast = useStore((state) => state.pushToast);

  // 只在掛載時讀一次 URL query 初始化篩選狀態；不做雙向同步，既有篩選邏輯不動。
  // month / account 這兩個 query key 是 /reflect（C 票）「點分類切片／商家列 → 跳到
  // 流水頁套上同一組 filter」的 drill-down 入口契約，不是沒人呼叫的遺留死碼；
  // C 票會帶著這兩個 key 導過來，這裡先留著給它接。
  const [searchParams] = useSearchParams();
  const initialMonth = searchParams.get("month");
  const initialAccount = searchParams.get("account");

  const [month, setMonth] = useState(() =>
    initialMonth && /^\d{4}-\d{2}$/.test(initialMonth)
      ? initialMonth
      : new Date().toISOString().slice(0, 7),
  );
  const [accountId, setAccountId] = useState<string | null>(() => initialAccount || null);
  const [status, setStatus] = useState<TxStatus | null>(null);
  // C 票 drill-down：/reflect 分類切片點過來會帶 ?category=<id>，前端過濾用（見 visibleItems）。
  const [categoryFilter, setCategoryFilter] = useState<string | null>(
    () => searchParams.get("category") || null,
  );
  const [sortMode, setSortMode] = useState<"date" | "amount_desc" | "amount_asc">("date");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [items, setItems] = useState<LedgerTransaction[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [loadingMore, setLoadingMore] = useState(false);

  const [editing, setEditing] = useState<LedgerTransaction | null>(null);

  // 競態防護：filter 切換後，較慢的舊回應不得覆蓋新結果
  const reqSeq = useRef(0);

  // 帳戶／分類只需要載一次（下拉與 chip 用）
  useEffect(() => {
    let alive = true;
    api
      .listAccounts()
      .then((data) => {
        if (alive) setAccounts(data);
      })
      .catch(() => {
        /* chip 退回只剩「全部帳戶」，不連坐 */
      });
    api
      .listCategories()
      .then((data) => {
        if (alive) setCategories(data.filter((c) => c.is_active !== 0));
      })
      .catch(() => {
        /* sheet 分類下拉退回現值 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const FETCH_TIMEOUT = 8000;

  const fetchPage = async (mode: "replace" | "more") => {
    const seq = ++reqSeq.current;
    const nextLimit = mode === "more" ? limit + PAGE_SIZE : PAGE_SIZE;
    const prevCount = items.length;
    if (mode === "replace") setListStatus("loading");
    else setLoadingMore(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const data = (await api.listTransactionsPaged({
        month,
        account: accountId ?? undefined,
        status: status ?? undefined,
        limit: nextLimit,
      }, { signal: controller.signal })) as LedgerTransaction[];
      if (seq !== reqSeq.current) return; // 已有較新的請求，丟棄此回應
      setItems(data);
      setLimit(nextLimit);
      setHasMore(
        data.length >= nextLimit && (mode === "replace" || data.length > prevCount),
      );
      setListStatus("loaded");
    } catch {
      if (seq !== reqSeq.current) return;
      if (mode === "more" || items.length > 0) {
        // 已載入資料保留不清空，只提示同步失敗
        setListStatus("loaded");
        pushToast("error", "同步失敗，已保留目前清單");
      } else {
        setListStatus("error");
      }
    } finally {
      window.clearTimeout(timer);
      setLoadingMore(false);
    }
  };

  // latest-ref：避免把變動中的 fetchPage 放進 deps 造成重新抓取迴圈
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  useEffect(() => {
    void fetchRef.current("replace");
  }, [month, accountId, status]);

  const applyPatch = (id: string, next: LedgerTransaction) =>
    setItems((prev) => prev.map((tx) => (tx.id === id ? next : tx)));

  const handleSave = async (snapshot: LedgerTransaction, patch: SheetPatch) => {
    // 樂觀更新 → PATCH；失敗回滾成 snapshot
    const optimistic: LedgerTransaction = {
      ...snapshot,
      ...patch,
      description: patch.description || null,
      notes: patch.notes || null,
      category_name: patch.category_id
        ? (categories.find((c) => c.id === patch.category_id)?.name ??
          snapshot.category_name)
        : null,
    };
    setEditing(null);
    applyPatch(snapshot.id, optimistic);
    try {
      const saved = (await api.updateTransaction(snapshot.id, {
        amount: patch.amount,
        date: patch.date,
        funding_account_id: patch.funding_account_id,
        category_id: patch.category_id,
        status: patch.status,
        description: patch.description || "",
        notes: patch.notes || "",
      })) as LedgerTransaction;
      applyPatch(snapshot.id, { ...optimistic, ...saved });
      window.dispatchEvent(new Event("ledger:data-changed"));
      pushToast("success", "已儲存變更");
    } catch {
      applyPatch(snapshot.id, snapshot);
      pushToast("error", "儲存失敗，已還原變更");
    }
  };

  const handleDelete = async (snapshot: LedgerTransaction) => {
    setEditing(null);
    setItems((prev) => prev.filter((tx) => tx.id !== snapshot.id));
    try {
      await api.deleteTransaction(snapshot.id);
      window.dispatchEvent(new Event("ledger:data-changed"));
      pushToast("success", "已刪除交易");
    } catch {
      setItems((prev) => [snapshot, ...prev]); // 回滾（清單會重新按日期排序）
      pushToast("error", "刪除失敗，已還原");
    }
  };

  // C 票分類 drill-down：後端 /transactions 沒有 category 參數，該月資料本來就一次撈滿，
  // 直接在 items 上做前端篩選；不改 fetchPage 的抓取邏輯。visibleItems 定義必須在
  // groups/totals 之前（它們依賴它），順序別再搬動。
  const visibleItems = useMemo(
    () => (categoryFilter ? items.filter((tx) => tx.category_id === categoryFilter) : items),
    [items, categoryFilter],
  );

  const groups = useMemo(() => {
    const sorted = [...visibleItems].sort((a, b) => {
      if (sortMode === "amount_desc") return a.amount - b.amount; // 負數愈小＝花愈多排前面
      if (sortMode === "amount_asc") return b.amount - a.amount;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.occurred_at ?? "").localeCompare(a.occurred_at ?? "");
    });
    if (sortMode !== "date") {
      // 金額排序：單一清單不按日期分組，直接平鋪
      return [["__flat__", sorted] as [string, LedgerTransaction[]]];
    }
    const map = new Map<string, LedgerTransaction[]>();
    for (const tx of sorted) {
      const key = tx.date || "未知日期";
      const bucket = map.get(key);
      if (bucket) bucket.push(tx);
      else map.set(key, [tx]);
    }
    return Array.from(map.entries());
  }, [visibleItems, sortMode]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of visibleItems) {
      if (!Number.isFinite(tx.amount)) continue;
      if (tx.amount >= 0) income += tx.amount;
      else expense += tx.amount;
    }
    return { income, expense, net: income + expense };
  }, [visibleItems]);

  const categoryOptions = useMemo(() => {
    const options = categories.map((c) => ({ id: c.id, name: c.name }));
    const currentId = editing?.category_id;
    if (currentId && !options.some((option) => option.id === currentId)) {
      options.unshift({
        id: currentId,
        name: editing?.category_name?.trim() || "目前分類",
      });
    }
    return options;
  }, [categories, editing]);

  const activeCategoryName = useMemo(() => {
    if (!categoryFilter) return null;
    return categories.find((c) => c.id === categoryFilter)?.name ?? categoryFilter;
  }, [categoryFilter, categories]);

  const hasChipFilter = accountId !== null || status !== null || categoryFilter !== null;
  const activeFilterCount =
    (accountId !== null ? 1 : 0) +
    (status !== null ? 1 : 0) +
    (categoryFilter !== null ? 1 : 0) +
    (sortMode !== "date" ? 1 : 0);
  const retry = () => {
    void fetchRef.current("replace");
  };

  return (
    <div className="ledger-page">
      <header className="lp-page-head">
        <div>
          <p className="page-kicker">流水</p>
          <h1 className="page-title">錢去哪了？</h1>
          <p className="page-subtitle">流水明細，點任一筆即可修改。</p>
        </div>
        <div className="lp-head-tools">
          <MonthSwitcher month={month} onChange={setMonth} />
          <button
            type="button"
            className="secondary-action lp-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="lp-filter-panel"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            {activeFilterCount > 0 ? `篩選 · ${activeFilterCount}` : "篩選"}
          </button>
        </div>
      </header>

      {filtersOpen ? (
        <div className="lp-filterbar">
          <div className="lp-filter-panel" id="lp-filter-panel">
            <div className="lp-chiprow" role="group" aria-label="帳戶篩選">
              <Chip
                label="全部帳戶"
                active={accountId === null}
                onClick={() => setAccountId(null)}
              />
              {accounts.map((account) => (
                <Chip
                  key={account.id}
                  label={account.nickname}
                  active={accountId === account.id}
                  onClick={() => setAccountId(account.id)}
                />
              ))}
            </div>
            <div className="lp-chiprow" role="group" aria-label="狀態篩選">
              <Chip
                label="全部狀態"
                active={status === null}
                onClick={() => setStatus(null)}
              />
              <Chip
                label="已確認"
                active={status === "confirmed"}
                onClick={() => setStatus("confirmed")}
              />
              <Chip
                label="待確認"
                active={status === "pending"}
                onClick={() => setStatus("pending")}
              />
            </div>
            <div className="lp-chiprow" role="group" aria-label="排序方式">
              <Chip
                label="依日期"
                active={sortMode === "date"}
                onClick={() => setSortMode("date")}
              />
              <Chip
                label="花最多→最少"
                active={sortMode === "amount_desc"}
                onClick={() => setSortMode("amount_desc")}
              />
              <Chip
                label="花最少→最多"
                active={sortMode === "amount_asc"}
                onClick={() => setSortMode("amount_asc")}
              />
            </div>
          </div>
        </div>
      ) : null}

      {listStatus === "error" && items.length === 0 ? (
        <LoadErrorCard onRetry={retry} />
      ) : (
        <>
          {listStatus !== "loading" ? (
            <div className="lp-subtotal" aria-label="本篩選小計">
              <div className="lp-subtotal-item">
                <span>收入</span>
                <strong className={totalMoneyClass(totals.income, "income")}>
                  {formatSignedMoney(totals.income)}
                </strong>
              </div>
              <div className="lp-subtotal-item">
                <span>支出</span>
                <strong className={totalMoneyClass(totals.expense, "expense")}>
                  {formatSignedMoney(totals.expense)}
                </strong>
              </div>
              <div className="lp-subtotal-item">
                <span>淨額</span>
                <strong className={flowMoneyClass(totals.net)}>
                  {formatSignedMoney(totals.net)}
                </strong>
              </div>
              <span className="lp-subtotal-count">已載入 {visibleItems.length} 筆</span>
            </div>
          ) : null}

          {listStatus !== "loading" && categoryFilter ? (
            <div className="lp-category-banner" role="status">
              <span>
                依分類「{activeCategoryName}」篩選中，共 {visibleItems.length} 筆
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="清除分類篩選"
                onClick={() => setCategoryFilter(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}

          {listStatus === "loading" ? (
            <SkeletonList />
          ) : visibleItems.length === 0 ? (
            hasChipFilter ? (
              <EmptyState
                icon={SearchX}
                title="無符合結果"
                description="調整篩選條件，或清除目前篩選再試試。"
                action={
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => {
                      setAccountId(null);
                      setStatus(null);
                      setCategoryFilter(null);
                    }}
                  >
                    清除篩選
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={Receipt}
                title="尚無交易"
                description="這個月份還沒有任何紀錄。"
                action={
                  <NavLink className="primary-action" to="/capture">
                    去記一筆
                  </NavLink>
                }
              />
            )
          ) : (
            <>
              <ul className="transactions-list lp-grouped">
                {groups.map(([date, txs]) => {
                  const dayNet = txs.reduce((sum, tx) => sum + tx.amount, 0);
                  return (
                    <li className="lp-day" key={date}>
                      <div className="lp-day-header">
                        <span>{date === "__flat__" ? `依金額排序（${formatMonthLabel(month)}）` : formatDayLabel(date)}</span>
                        <strong className="lp-tx-subtotal">
                          小計 {formatSignedMoney(dayNet)}
                        </strong>
                      </div>
                      <ul className="lp-day-list">
                        {txs.map((tx) => (
                          <TxRow
                            key={tx.id}
                            tx={tx}
                            onOpen={() => setEditing(tx)}
                          />
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>

              {loadingMore ? (
                <p className="lp-more-note" role="status">
                  載入中…
                </p>
              ) : hasMore ? (
                <button
                  className="secondary-action lp-more"
                  type="button"
                  onClick={() => void fetchRef.current("more")}
                >
                  載入更多
                </button>
              ) : (
                <p className="lp-more-note">已顯示全部 {visibleItems.length} 筆</p>
              )}
            </>
          )}
        </>
      )}

      {editing ? (
        <EditSheet
          key={editing.id}
          tx={editing}
          categoryOptions={categoryOptions}
          accountOptions={accounts
            .filter((a) => a.is_active !== 0)
            .map((a) => ({ id: a.id, nickname: a.nickname }))}
          onClose={() => setEditing(null)}
          onSave={(patch) => void handleSave(editing, patch)}
          onDelete={() => void handleDelete(editing)}
        />
      ) : null}
    </div>
  );
}
