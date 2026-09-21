import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CopyX,
  LayoutDashboard,
  List,
  PieChart,
  Plus,
  Receipt,
  RefreshCcw,
  Settings,
  Sparkles,
  Target,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Budget,
  CategoryBreakdown,
  OverviewSummary,
  RecentTransaction,
  TxStatus,
} from "./types";
import { flowMoneyClass, totalMoneyClass } from "./utils/money";
import { toTaipeiTime } from "./utils/datetime";
import { burnRateLabel, useInsights } from "./utils/insights";
import { api } from "./api";
import { useStore } from "./store/useStore";
import { LedgerPage } from "./pages/LedgerPage";
import { CapturePage } from "./pages/CapturePage";
import { MapPage } from "./pages/MapPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AssistantPage } from "./pages/AssistantPage";
import { HomeAssistantPage } from "./pages/HomeAssistantPage";
import { ReflectPage } from "./pages/ReflectPage";
import { SetupPage } from "./pages/SetupPage";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { to: "/", label: "助理", icon: Sparkles },
  { to: "/dashboard", label: "總覽", icon: LayoutDashboard },
  { to: "/capture", label: "記一筆", icon: Plus },
  { to: "/ledger", label: "流水", icon: List },
  { to: "/reflect", label: "分析", icon: PieChart },
  { to: "/settings", label: "我的", icon: Settings },
];

/** 手機底欄：6 鍵平分（0909 centered-FAB 攔截鄰 tab 點擊，0910 user 定案拿掉 FAB） */
const NAV_MOBILE = NAV;

const moneyFormatter = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 1,
});

const statusMeta: Record<
  TxStatus,
  { label: string; icon: LucideIcon }
> = {
  pending: { label: "待確認", icon: Clock3 },
  confirmed: { label: "已確認", icon: CheckCircle2 },
  archived: { label: "已封存", icon: Archive },
  duplicate: { label: "疑似重複", icon: CopyX },
};

function formatMoney(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  const sign = minor < 0 ? "−" : "";
  return `${sign}NT$${moneyFormatter.format(Math.abs(minor) / 100)}`;
}

function formatSignedMoney(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  if (minor === 0) return formatMoney(minor);
  const sign = minor < 0 ? "−" : "+";
  return `${sign}NT$${moneyFormatter.format(Math.abs(minor) / 100)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${percentFormatter.format(value)}%`;
}

function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}年${Number(match[2])}月`;
}

function formatFullDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
}

function shiftMonth(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function SectionHeading({
  eyebrow,
  title,
  titleId,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  titleId?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
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

function MonthSwitcher({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="month-switcher" aria-label="月份切換">
      <button
        className="icon-button"
        type="button"
        aria-label="上一個月"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <span className="month-switcher-label" aria-live="polite">
        {formatMonthLabel(month)}
      </span>
      <button
        className="icon-button"
        type="button"
        aria-label="下一個月"
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

function BudgetSummary({
  overview,
  selectedMonth,
  onMonthChange,
  insightText,
}: {
  overview: OverviewSummary;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  insightText: string | null;
}) {
  const budgetConfigured = overview.budget_limit_minor > 0;
  const overBudget = overview.is_over_budget;
  const progressWidth = budgetConfigured
    ? Math.min(100, Math.max(0, overview.budget_pct_used))
    : 0;
  const forecastOverBudget =
    budgetConfigured &&
    (overBudget || overview.forecast_end_minor > overview.budget_limit_minor);

  return (
    <section className="summary-stack" aria-labelledby="summary-title">
      <div className="page-heading-row">
        <div>
          <p className="page-kicker">總覽</p>
          <h1 className="page-title" id="summary-title">
            今天還能花多少？
          </h1>
          <p className="page-subtitle">本月收支與預算節奏，一眼掌握。</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginLeft: "auto" }}>
          <NavLink className="secondary-action" to="/assistant">
            <Sparkles size={16} aria-hidden="true" />
            問助理
          </NavLink>
          <MonthSwitcher month={selectedMonth} onChange={onMonthChange} />
        </div>
      </div>

      {/* 有預算＝safe-to-spend 大數＋進度條單一 hero；無預算＝單張引導卡＋灰色零值收支 */}
      <article
        className={`card summary-hero${budgetConfigured && overBudget ? " summary-hero--over" : ""}`}
      >
        {budgetConfigured ? (
          <>
            <div className="hero-heading">
              <div>
                <p className="section-eyebrow">本月概況</p>
                <h2 className="hero-label">今天可花</h2>
              </div>
              <WalletCards
                className="hero-icon"
                size={22}
                strokeWidth={1.6}
                aria-hidden="true"
              />
            </div>

            <p
              className={`money hero-value${overview.safe_to_spend_minor < 0 ? " money-negative" : ""}`}
            >
              {formatMoney(overview.safe_to_spend_minor)}
            </p>
            <p className="hero-support">
              已花 {formatMoney(overview.budget_spent_minor)} / 上限{" "}
              {formatMoney(overview.budget_limit_minor)} · 本月第{" "}
              {overview.days_elapsed} / {overview.days_total} 天
            </p>

            <div
              className="progress-track"
              role="progressbar"
              aria-label="本月預算使用率"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, overview.budget_pct_used)}
            >
              <div
                className={`progress-fill${overBudget ? " progress-fill--over" : ""}`}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <div className="progress-meta">
              <span>已使用 {formatPercent(overview.budget_pct_used)}</span>
              <span>剩餘 {overview.days_remaining} 天</span>
            </div>
            <p className={`budget-health${overBudget ? " budget-health--over" : ""}`}>
              {overBudget ? (
                <AlertCircle size={16} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={16} aria-hidden="true" />
              )}
              <span>
                {overBudget
                  ? "可能超支"
                  : overview.budget_pct_used >= 80
                    ? "接近本月上限"
                    : "目前在預算內"}
              </span>
            </p>
            <p className={`forecast-line${forecastOverBudget ? " forecast-line--over" : ""}`}>
              月底預估 {formatMoney(overview.forecast_end_minor)}
              {forecastOverBudget
                ? "，依目前速度會超過上限"
                : "，依目前支出速度推估"}
            </p>
          </>
        ) : (
          <>
            <p className="section-eyebrow">本月概況</p>
            <EmptyState
              icon={Target}
              title="還沒有預算"
              description="設定本月上限後，這裡會顯示今天可花、預算進度與月底預估。"
              action={
                <NavLink className="primary-action" to="/budget">
                  設定本月預算
                </NavLink>
              }
            />
          </>
        )}

        <div className="hero-substats">
          <div className="hero-substat">
            <span>本月支出</span>
            <strong className={totalMoneyClass(overview.expense_minor, "expense")}>
              {formatMoney(overview.expense_minor)}
            </strong>
          </div>
          <div className="hero-substat">
            <span>本月收入</span>
            <strong className={totalMoneyClass(overview.income_minor, "income")}>
              {formatMoney(overview.income_minor)}
            </strong>
          </div>
        </div>
        {insightText ? <p className="hero-support">洞察：{insightText}</p> : null}
      </article>
    </section>
  );
}

function StatusBadge({ status }: { status: TxStatus }) {
  const meta = statusMeta[status];
  const Icon = meta.icon;
  return (
    <span className={`status-badge status-badge--${status}`}>
      <Icon size={14} strokeWidth={1.9} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function transactionTitle(transaction: RecentTransaction): string {
  return (
    transaction.merchant?.trim() ||
    transaction.description?.trim() ||
    "未命名交易"
  );
}

// 總覽減肥（brief C8）：只留最近 5 筆，其餘交給 /ledger。
const DASHBOARD_RECENT_COUNT = 5;

function RecentTransactionsSection({
  overview,
  demotePrimaryCta,
}: {
  overview: OverviewSummary;
  /** 無預算時 Hero 已經有一顆「設定本月預算」primary，這裡的「記一筆」降級成 ghost，避免同頁兩顆 primary。 */
  demotePrimaryCta: boolean;
}) {
  const hasTransactions = overview.transactions_count > 0;
  const recent = overview.recent_transactions.slice(0, DASHBOARD_RECENT_COUNT);
  return (
    <section className="card dashboard-card" aria-labelledby="recent-title">
      <SectionHeading
        eyebrow="紀錄"
        title="最近交易"
        titleId="recent-title"
        description={hasTransactions ? `最近 ${recent.length} 筆` : undefined}
        action={
          <NavLink className="text-action" to="/ledger">
            查看全部
            <ChevronRight size={16} aria-hidden="true" />
          </NavLink>
        }
      />
      {!hasTransactions ? (
        <EmptyState
          icon={Receipt}
          title="本月尚無交易"
          description="記下第一筆交易，開始建立你的本月紀錄。"
          action={
            <NavLink className={demotePrimaryCta ? "secondary-action" : "primary-action"} to="/capture">
              <Plus size={17} aria-hidden="true" />
              記一筆
            </NavLink>
          }
        />
      ) : recent.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="目前沒有最近交易"
          description="這個月份目前沒有可顯示的交易明細。"
        />
      ) : (
        <ul className="transactions-list">
          {recent.map((transaction) => (
            <li
              className={`transaction-item${transaction.status === "pending" ? " transaction-item--pending" : ""}`}
              key={transaction.id}
            >
              <article className="transaction-row">
                <div className="transaction-main">
                  <div className="transaction-title-row">
                    <h3 className="transaction-title">{transactionTitle(transaction)}</h3>
                    <StatusBadge status={transaction.status} />
                  </div>
                  <div className="transaction-meta">
                    <time dateTime={transaction.occurred_at || transaction.date}>{formatFullDate(transaction.date)}{transaction.occurred_at ? ` ${toTaipeiTime(transaction.occurred_at)}` : ""}</time>
                    <span>{transaction.category_name?.trim() || "未分類"}</span>
                    {transaction.account_nickname?.trim() ? (
                      <span>{transaction.account_nickname}</span>
                    ) : null}
                  </div>
                </div>
                <strong className={`transaction-amount ${flowMoneyClass(transaction.amount)}`}>
                  {formatSignedMoney(transaction.amount)}
                </strong>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="loading-page" aria-busy="true" aria-label="正在載入總覽">
      <div className="loading-heading">
        <div className="skeleton skeleton-kicker" />
        <div className="skeleton skeleton-page-title" />
        <div className="skeleton skeleton-subtitle" />
        <div className="skeleton skeleton-month" />
      </div>
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-section" />
      <p className="loading-copy">正在載入本月資料…</p>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <section className={`error-card${compact ? " error-card--compact" : ""}`} role="alert">
      <div className="error-icon" aria-hidden="true">
        <AlertCircle size={22} strokeWidth={1.8} />
      </div>
      <div className="error-copy">
        <h2>載入失敗</h2>
        <p>{message || "目前無法取得總覽資料，請稍後再試。"}</p>
      </div>
      <button className="secondary-action" type="button" onClick={onRetry}>
        <RefreshCcw size={16} aria-hidden="true" />
        重試
      </button>
    </section>
  );
}

function DashboardContent() {
  const overview = useStore((state) => state.overview);
  const overviewState = useStore((state) => state.overviewState);
  const selectedMonth = useStore((state) => state.selectedMonth);
  const setSelectedMonth = useStore((state) => state.setSelectedMonth);
  const loadOverview = useStore((state) => state.loadOverview);

  const overviewLoading = overviewState.status === "loading";
  const overviewError = overviewState.status === "error" ? overviewState.error : undefined;

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, selectedMonth]);

  // Hero 的一句洞察：走 utils/insights.ts 的共用資料源，不在總覽再算一套。
  const insightsState = useInsights(selectedMonth);
  const insightText =
    insightsState.status === "loaded" ? burnRateLabel(insightsState.data.burn_rate) : null;

  const retry = () => {
    void loadOverview();
  };

  if (overviewLoading || (!overview && !overviewError)) {
    return <DashboardSkeleton />;
  }

  if (!overview) {
    return <ErrorCard message={overviewError ?? "目前無法取得總覽資料。"} onRetry={retry} />;
  }

  // 無預算 + 本月零交易時，Hero 的「設定本月預算」與最近交易卡的「記一筆」
  // 兩顆 primary-action 會同頁出現；降級後者成 ghost，頁面維持單一 primary。
  const budgetConfigured = overview.budget_limit_minor > 0;

  return (
    <div className="dashboard-content">
      {overviewError ? <ErrorCard message={overviewError} onRetry={retry} compact /> : null}
      <BudgetSummary
        overview={overview}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        insightText={insightText}
      />
      <div className="dashboard-sections">
        <RecentTransactionsSection overview={overview} demotePrimaryCta={!budgetConfigured} />
      </div>
    </div>
  );
}

function AppNavigation() {
  return (
    <>
      <aside className="sidebar">
        <NavLink className="brand" to="/" end>
          <span className="brand-mark" aria-hidden="true">L</span>
          <span>
            <strong className="brand-title">Ledger</strong>
            <small className="brand-subtitle">留百工作室 · local-first</small>
          </span>
        </NavLink>
        <nav aria-label="主要導覽">
          <ul className="sidebar-nav">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    className={({ isActive }) =>
                      `sidebar-item${isActive ? " active" : ""}`
                    }
                    to={item.to}
                    end={item.to === "/"}
                  >
                    <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <nav className="mobile-nav" aria-label="主要導覽">
        {NAV_MOBILE.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
      </nav>
    </>
  );
}

function MobileTab({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      className={({ isActive }) => `mobile-nav-item${isActive ? " active" : ""}`}
      to={item.to}
      end={item.to === "/"}
    >
      <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function Toasts() {
  const toasts = useStore((state) => state.toasts);
  const removeToast = useStore((state) => state.removeToast);

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => removeToast(toast.id), 4000),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [removeToast, toasts]);

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div
          className={`toast toast--${toast.type}`}
          key={toast.id}
          role={toast.type === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            className="toast-close"
            type="button"
            aria-label="關閉通知"
            onClick={() => removeToast(toast.id)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function BudgetPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [limitText, setLimitText] = useState("50000");
  const [bufferText, setBufferText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getBudget(month).then((b: Budget) => {
      if (!alive) return;
      setBudgetId(b.id ?? null);
      setLimitText(b.total_limit_minor > 0 ? String(b.total_limit_minor / 100) : "");
      setBufferText(b.safety_buffer_minor > 0 ? String(b.safety_buffer_minor / 100) : "");
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { alive = false; };
  }, [month]);

  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [catRows, setCatRows] = useState<CategoryBreakdown[]>([]);
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});
  const [savingCats, setSavingCats] = useState(false);

  useEffect(() => {
    if (!budgetId) { setCatRows([]); return; }
    let alive = true;
    api.getCategoriesSummary(month).then((rows) => {
      if (!alive) return;
      setCatRows(rows);
      const inputs: Record<string, string> = {};
      for (const r of rows) {
        if (r.limit_minor > 0) inputs[r.category_id] = String(r.limit_minor / 100);
      }
      setLimitInputs(inputs);
    }).catch(() => {});
    return () => { alive = false; };
  }, [budgetId, month]);

  const saveCatLimits = async () => {
    if (!budgetId) return;
    setSavingCats(true);
    try {
      for (const [catId, val] of Object.entries(limitInputs)) {
        const minor = Math.round(parseFloat(val || "0") * 100);
        if (!Number.isFinite(minor) || minor <= 0) continue;
        await api.upsertCategoryLimit(budgetId, { category_id: catId, category_limit_minor: minor });
      }
      const rows = await api.getCategoriesSummary(month);
      setCatRows(rows);
      setMsg("分類限額已儲存 ✓");
    } catch {
      setMsg("儲存失敗");
    } finally {
      setSavingCats(false);
    }
  };

  const save = async () => {
    const minor = Math.round(parseFloat(limitText) * 100);
    if (!Number.isFinite(minor) || minor <= 0) {
      setMsg("請輸入有效預算金額");
      return;
    }
    const bufMinor = Math.round(parseFloat(bufferText || "0") * 100);
    setSaving(true);
    setMsg(null);
    try {
      if (budgetId) {
        // 已存在 → PATCH /budgets/{id}
        await api.patchBudget({
          total_limit_minor: minor,
          safety_buffer_minor: Number.isFinite(bufMinor) && bufMinor <= minor ? bufMinor : 0,
        }, budgetId);
      } else {
        const b = await api.upsertBudget({ period_month: month, total_limit_minor: minor,
          safety_buffer_minor: Number.isFinite(bufMinor) && bufMinor <= minor ? bufMinor : 0 });
        setBudgetId(b.id ?? null);
      }
      setMsg("已儲存 ✓ 回總覽看今日可花與預估");
    } catch {
      setMsg("儲存失敗，再試一次");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="budget-page">
      <header className="page-header">
        <p className="section-eyebrow">預算</p>
        <h1 className="page-title">本月上限</h1>
        <p className="section-description">設定後總覽會顯示今天可花、進度與月底預估。</p>
      </header>
      <div className="card budget-card">
        <div className="month-switcher" style={{ marginBottom: 12 }}>
          <button className="icon-button" type="button" aria-label="上一個月"
            onClick={() => { const d = new Date(month + "-01T12:00:00"); d.setMonth(d.getMonth() - 1); setMonth(d.toISOString().slice(0, 7)); }}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <strong>{month}</strong>
          <button className="icon-button" type="button" aria-label="下一個月"
            onClick={() => { const d = new Date(month + "-01T12:00:00"); d.setMonth(d.getMonth() + 1); setMonth(d.toISOString().slice(0, 7)); }}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        {loaded ? (
          <>
            <div className="lp-field">
              <label className="lp-label" htmlFor="bp-limit">本月總預算（NT$）</label>
              <input id="bp-limit" className="lp-input lp-input--amount" type="text" inputMode="decimal"
                placeholder="例如 30000" value={limitText}
                onChange={(e) => { setLimitText(e.target.value); setMsg(null); }} />
            </div>
            <div className="lp-field">
              <label className="lp-label" htmlFor="bp-buffer">安全緩衝（可留空）</label>
              <input id="bp-buffer" className="lp-input lp-input--amount" type="text" inputMode="decimal"
                placeholder="預留不打到的金額" value={bufferText}
                onChange={(e) => { setBufferText(e.target.value); setMsg(null); }} />
            </div>
            {msg ? (
              <p className={msg.includes("✓") ? "budget-saved-note" : "lp-field-error"} role="status">
                {msg}
              </p>
            ) : null}
            <button className="primary-action" type="button" disabled={saving} onClick={() => void save()}>
              {saving ? "儲存中…" : "儲存預算"}
            </button>
          </>
        ) : (
          <p className="map-loading">載入中…</p>
        )}
      </div>
      {budgetId && loaded && catRows.length > 0 && (
        <div className="card budget-card" style={{ marginTop: 16 }}>
          <p className="section-eyebrow">分類</p>
          <h2 className="section-title" style={{ fontSize: 18, margin: "0 0 12px" }}>分類限額</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {catRows.filter(r => r.category_id != null).map(row => {
              const spent = row.spent_minor;
              const limit = row.limit_minor ?? 0;
              const pct = limit > 0 ? Math.min(100, Math.max(0, spent / limit * 100)) : 0;
              return (
                <div key={row.category_id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{row.name}</span>
                    <span className="money" style={{ fontSize: 13 }}>
                      {formatMoney(spent)}{limit > 0 ? ` / ${formatMoney(limit)}` : ""}
                    </span>
                  </div>
                  {limit > 0 && (
                    <div className="progress-track" style={{ height: 4, marginBottom: 6 }}>
                      <div className={`progress-fill${spent > limit ? " progress-fill--over" : ""}`}
                           style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <input type="text" inputMode="decimal"
                         className="lp-input"
                         style={{ width: "100%", fontSize: 14, padding: "6px 8px", boxSizing: "border-box" }}
                         placeholder="限額 (NT$)"
                         value={limitInputs[row.category_id] ?? ""}
                         onChange={e => setLimitInputs(prev => ({...prev, [row.category_id]: e.target.value}))} />
                </div>
              );
            })}
          </div>
          <button className="primary-action" type="button" disabled={savingCats}
                  onClick={() => void saveCatLimits()}
                  style={{ marginTop: 12, width: "100%" }}>
            {savingCats ? "儲存中…" : "儲存分類限額"}
          </button>
        </div>
      )}
    </div>
  );
}

export function App() {
  const pathname = useLocation().pathname;
  return (
    <div className="app-shell">
      <AppNavigation />
      <main className="main">
        {pathname === "/" ? (
          <HomeAssistantPage />
        ) : pathname === "/dashboard" ? (
          <DashboardContent />
        ) : pathname === "/ledger" ? (
          <LedgerPage />
        ) : pathname === "/capture" ? (
          <CapturePage />
        ) : pathname === "/map" ? (
          <MapPage />
        ) : pathname === "/budget" ? (
          <BudgetPage />
        ) : pathname === "/settings" ? (
          <SettingsPage />
        ) : pathname === "/setup" ? (
          <SetupPage />
        ) : pathname === "/assistant" ? (
          <AssistantPage />
        ) : pathname === "/reflect" ? (
          <ReflectPage />
        ) : (
          /* 地圖／預算已降為「我的」次級入口；其餘未知路徑落首頁助理 */
          <HomeAssistantPage />
        )}
      </main>
      <Toasts />
    </div>
  );
}