// ReflectPage — 分析頁（C 票：把 LedgerPage 的 lp-analysis 整塊搬過來，不留副本）。
// 四張圖卡：本月現金流／分類占比／商家 Top-N／花費節奏（+ 近三月趨勢，原本就在 lp-analysis 裡一起搬過來）。
// insights 一律走 utils/insights.ts 的 useInsights()，不在這裡再呼叫一次 api.getInsights()。

import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { PieChart as PieChartIcon, Receipt } from "lucide-react";
import { MonthSwitcher } from "../components/MonthSwitcher";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { Category, OverviewSummary } from "../types";
import { flowMoneyClass, totalMoneyClass, clampPct } from "../utils/money";
import { burnRateLabel, burnRateProgressClass, topMerchants, useInsights } from "../utils/insights";

const CAT_COLORS: Record<string, string> = {
  c_food: "#e8833a",
  c_transport: "#3b82f6",
  c_home: "#14b8a6",
  c_shopping: "#8b5cf6",
  c_fun: "#ec4899",
  c_health: "#22c55e",
  c_education: "#6366f1",
  c_bills: "#64748b",
  c_travel: "#0ea5e9",
  c_ai: "#f59e0b",
  c_other: "#94a3b8",
  __uncategorized__: "#c0c7d2",
};

// 支付方式分布（原 App.tsx DashboardContent 的 DistributionSection，搬過來併進本月現金流卡）。
const PAYMENT_COLORS = ["var(--accent)", "var(--success)", "var(--warning)", "var(--error)"];

function fmtMoney0(minor: number): string {
  return `NT$${(minor / 100).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** 支出帶負號、收入帶加號；跟 LedgerPage 的 formatSignedMoney 同規則。 */
function formatSignedMoney(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  if (minor === 0) return `NT$0`;
  const sign = minor < 0 ? "−" : "+";
  return `${sign}${fmtMoney0(Math.abs(minor))}`;
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { fill?: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-swatch" style={{ backgroundColor: p.payload?.fill }} aria-hidden="true" />
        <span>{p.name}</span>
        <strong className="money">{fmtMoney0(p.value ?? 0)}</strong>
      </div>
    </div>
  );
}

function TrendTooltip({
  active,
  label,
  payload,
  catNames,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string; value?: number; fill?: string }[];
  catNames: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const visible = payload.filter((p) => (p.value ?? 0) > 0);
  if (visible.length === 0) return null;
  const total = visible.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{label}</p>
      {visible.map((p) => (
        <div className="chart-tooltip-row" key={p.dataKey}>
          <span className="chart-tooltip-swatch" style={{ backgroundColor: p.fill }} aria-hidden="true" />
          <span>{catNames[p.dataKey ?? ""] ?? p.dataKey}</span>
          <strong className="money">NT${Math.round(p.value ?? 0).toLocaleString("zh-TW")}</strong>
        </div>
      ))}
      <div className="chart-tooltip-row" style={{ borderTop: "1px solid var(--border)", paddingTop: 4, marginTop: 4 }}>
        <span style={{ fontWeight: 600 }}>合計</span>
        <strong className="money">NT${Math.round(total).toLocaleString("zh-TW")}</strong>
      </div>
    </div>
  );
}

type PaceTooltipEntry = {
  dataKey?: string;
  value?: number | string | null;
  color?: string;
};

/** 搬自 App.tsx 的 DashboardContent（原 PaceSection/PaceChart/PaceTooltip），併進「花費節奏」卡。 */
function PaceTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: PaceTooltipEntry[];
}) {
  const entries = (payload ?? []).filter((e) => e.value !== null && e.value !== undefined);
  if (!active || entries.length === 0) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label ?? "");
  const fullDate = match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : label;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{fullDate}</p>
      {entries.map((entry) => (
        <div className="chart-tooltip-row" key={entry.dataKey}>
          <span
            className="chart-tooltip-swatch"
            style={{ backgroundColor: entry.color ?? "var(--ink-3)" }}
            aria-hidden="true"
          />
          <span>{entry.dataKey === "actual_minor" ? "實際累計" : "理想預算"}</span>
          <strong className="money">{fmtMoney0(Number(entry.value))}</strong>
        </div>
      ))}
    </div>
  );
}

function PaceChart({ pace }: { pace: OverviewSummary["pace"] }) {
  return (
    <div className="pace-chart" role="img" aria-label="實際累計支出與理想預算線圖表">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pace} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => {
              const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
              return m ? `${Number(m[2])}/${Number(m[3])}` : d;
            }}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={20}
          />
          <YAxis
            tickFormatter={(v: number) => fmtMoney0(v)}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            content={<PaceTooltip />}
            cursor={{ stroke: "var(--border)" }}
            wrapperStyle={{ outline: "none" }}
          />
          <Line
            type="monotone"
            dataKey="pace_minor"
            name="理想預算"
            stroke="var(--warning)"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            activeDot={{ r: 5, fill: "var(--surface)" }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual_minor"
            name="實際累計"
            stroke="var(--accent)"
            strokeWidth={2.5}
            dot={false}
            connectNulls={false}
            activeDot={{ r: 5, fill: "var(--surface)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CardHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="card-heading">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h2 className="section-title">{title}</h2>
        <p className="section-description">{description}</p>
      </div>
    </div>
  );
}

export function ReflectPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // 分析頁月份可切換（2026-09-08 user 要求「不能切月份」）：
  // 預設當月；所有查詢（overview/insights/明細）都跟著 month 重抓。
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const [overview, setOverview] = useState<OverviewSummary | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  const insightsState = useInsights(month);

  useEffect(() => {
    let alive = true;
    setOverviewFailed(false);
    api
      .getOverview(month)
      .then((data) => {
        if (alive) setOverview(data);
      })
      .catch(() => {
        if (alive) setOverviewFailed(true);
      });
    api
      .listCategories()
      .then((data) => {
        if (alive) setCategories(data);
      })
      .catch(() => {
        /* 分類名稱退回顯示原始 id，不連坐整頁 */
      });
    return () => {
      alive = false;
    };
  }, [month]);

  // /reflect#merchants 直接開或從助理頁跳過來時，捲到商家排行卡。
  useEffect(() => {
    if (location.hash !== "#merchants" || insightsState.status === "loading") return;
    const el = document.getElementById("merchants");
    el?.scrollIntoView({ block: "start" });
  }, [location.hash, insightsState.status]);

  // 分類圓餅與支付方式一律吃 /api/insights 的 canonical totals。
  // 後端口徑固定為 confirmed + expense/unknown，避免 pending/transfer 混進分析頁。
  const expenseTotal = insightsState.data?.total_spent_minor ?? 0;
  const categoryStats = useMemo(
    () =>
      (insightsState.data?.category_totals ?? []).map((row) => ({
        id: row.category_id,
        name: row.name,
        total: row.total_minor,
        count: row.count,
      })),
    [insightsState.data],
  );

  const merchantList = useMemo(() => topMerchants(insightsState.data, 5), [insightsState.data]);

  const accountStats = useMemo(() => {
    const rows = insightsState.data?.account_totals ?? [];
    const total = rows.reduce((sum, row) => sum + row.total_minor, 0);
    if (total <= 0) return [];
    return rows.map((row) => ({
      id: row.account_id,
      name: row.name,
      amountMinor: row.total_minor,
      share: row.total_minor / total,
      count: row.count,
    }));
  }, [insightsState.data]);

  const catNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[c.id] = c.name;
    m.c_other = "其他";
    m.__uncategorized__ = "未分類";
    return m;
  }, [categories]);

  const trendData = useMemo(() => {
    const trend = insightsState.data?.category_trend;
    if (!trend) return { chartData: [] as Record<string, string | number>[], allCats: [] as string[] };
    const months = Object.keys(trend).sort();
    const allCatsSet = new Set<string>();
    for (const mo of months) for (const cat of Object.keys(trend[mo])) allCatsSet.add(cat);
    const allCats = Array.from(allCatsSet);
    const chartData = months.map((mo) => {
      const match = /^(\d{4})-(\d{2})$/.exec(mo);
      const label = match ? `${Number(match[2])}月` : mo;
      const row: Record<string, string | number> = { month: label };
      for (const cat of allCats) row[cat] = (trend[mo][cat] ?? 0) / 100;
      return row;
    });
    return { chartData, allCats };
  }, [insightsState.data]);

  const monthComparison = useMemo(() => {
    const trend = insightsState.data?.category_trend;
    if (!trend) return null;
    const months = Object.keys(trend).sort();
    if (months.length < 2) return null;
    const curTotal = Object.values(trend[months[months.length - 1]]).reduce((s, v) => s + v, 0);
    const prevTotal = Object.values(trend[months[months.length - 2]]).reduce((s, v) => s + v, 0);
    if (prevTotal === 0) return null;
    return { pctChange: ((curTotal - prevTotal) / prevTotal) * 100 };
  }, [insightsState.data]);

  const topCategory = categoryStats[0] ?? null;
  const topMerchantThisMonth = merchantList[0] ?? null;

  const goToCategory = (categoryId: string) => {
    navigate(`/ledger?month=${month}&category=${encodeURIComponent(categoryId)}`);
  };
  const goToAccount = (accountId: string) => {
    navigate(`/ledger?month=${month}&account=${encodeURIComponent(accountId)}`);
  };
  const goToMerchants = () => {
    navigate(`/ledger?month=${month}`);
  };

  return (
    <div className="dashboard-content reflect-page">
      <header className="page-header lp-head-tools rf-page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <p className="page-kicker">分析</p>
          <h1 className="page-title">這個月的錢花去哪</h1>
          <p className="page-subtitle">分類佔比、商家排行與趨勢，點圖就能跳到對應的流水。</p>
        </div>
        <MonthSwitcher month={month} onChange={setMonth} />
      </header>

      {/* 1. 本月現金流 */}
      <section className="card dashboard-card rf-card rf-card--cashflow" aria-label="本月現金流">
        {overview ? (
          <>
            <CardHead
              eyebrow="本月現金流"
              title="收支概況"
              description={`這個月收入 ${fmtMoney0(overview.income_minor)}、支出 ${fmtMoney0(
                overview.expense_minor,
              )}，淨${overview.net_minor >= 0 ? "流入" : "流出"} ${fmtMoney0(
                Math.abs(overview.net_minor),
              )}（已記 ${overview.transactions_count} 筆）。`}
            />
            <div className="rf-stat-row">
              <div className="rf-stat-card">
                <span className="rf-stat-label">收入</span>
                <strong className={`rf-stat-value ${totalMoneyClass(overview.income_minor, "income")}`}>
                  {formatSignedMoney(overview.income_minor)}
                </strong>
              </div>
              <div className="rf-stat-card">
                <span className="rf-stat-label">支出</span>
                <strong className={`rf-stat-value ${totalMoneyClass(overview.expense_minor, "expense")}`}>
                  {formatSignedMoney(-overview.expense_minor)}
                </strong>
              </div>
              <div className="rf-stat-card">
                <span className="rf-stat-label">淨額</span>
                <strong className={`rf-stat-value ${flowMoneyClass(overview.net_minor)}`}>
                  {formatSignedMoney(overview.net_minor)}
                </strong>
              </div>
            </div>
            {/* 支付方式分布：原總覽頁的 DistributionSection，併進現金流卡而不是另開一張。 */}
            {accountStats.length > 0 ? (
              <div className="distribution-content" style={{ marginTop: "var(--space-lg)" }}>
                <p className="section-eyebrow">依支付方式</p>
                <div className="distribution-bar" aria-hidden="true">
                  {accountStats.map((row, index) => (
                    <button
                      type="button"
                      className="distribution-segment"
                      key={row.id}
                      title={`${row.name} ${Math.round(row.share * 100)}%`}
                      aria-label={`看「${row.name}」的流水，共 ${fmtMoney0(row.amountMinor)}`}
                      onClick={() => goToAccount(row.id)}
                      style={{
                        backgroundColor: PAYMENT_COLORS[index % PAYMENT_COLORS.length],
                        width: `${row.share * 100}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="distribution-list">
                  {accountStats.map((row, index) => (
                    <button
                      type="button"
                      className="distribution-row"
                      key={row.id}
                      onClick={() => goToAccount(row.id)}
                      aria-label={`看「${row.name}」的流水，共 ${fmtMoney0(row.amountMinor)}，佔 ${Math.round(row.share * 100)}%`}
                    >
                      <div className="distribution-name">
                        <span
                          className="distribution-swatch"
                          style={{ backgroundColor: PAYMENT_COLORS[index % PAYMENT_COLORS.length] }}
                          aria-hidden="true"
                        />
                        <span>{row.name}</span>
                      </div>
                      <div className="distribution-values">
                        <strong className="money">{fmtMoney0(row.amountMinor)}</strong>
                        <span>{Math.round(row.share * 100)}%</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : overviewFailed ? (
          <p className="section-description">現金流資料讀取失敗，稍後再試。</p>
        ) : (
          <p className="section-description">載入中…</p>
        )}
      </section>

      {/* 2. 分類占比 */}
      <section className="card dashboard-card rf-card rf-card--category" aria-label="分類占比">
        <CardHead
          eyebrow="分類占比"
          title="本月支出分類"
          description={
            topCategory
              ? `本月花費最多的是「${topCategory.name}」，佔 ${
                  expenseTotal > 0 ? Math.round((topCategory.total / expenseTotal) * 100) : 0
                }%。`
              : insightsState.status === "loading"
                ? "載入中…"
                : "本月還沒有已確認支出，記幾筆再回來看分類占比。"
          }
        />
        {categoryStats.length > 0 ? (
          <>
            <div className="rf-pie-wrap">
              <div className="rf-pie-center" aria-hidden="true">
                <span>本月支出</span>
                <strong>{fmtMoney0(expenseTotal)}</strong>
              </div>
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie
                    data={categoryStats}
                    dataKey="total"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={78}
                    paddingAngle={2}
                    strokeWidth={0}
                    isAnimationActive={false}
                    cursor="pointer"
                    onClick={(entry) => {
                      const payload = entry as { payload?: { id?: string }; id?: string };
                      const id = payload?.payload?.id ?? payload?.id;
                      if (id) goToCategory(id);
                    }}
                  >
                    {categoryStats.map((cat) => (
                      <Cell key={cat.id} fill={CAT_COLORS[cat.id] ?? "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="rf-pie-legend">
              {categoryStats.map((cat) => {
                const pct = expenseTotal > 0 ? Math.round((cat.total / expenseTotal) * 100) : 0;
                return (
                  <button
                    type="button"
                    className="rf-pie-legend-item"
                    key={cat.id}
                    onClick={() => goToCategory(cat.id)}
                    aria-label={`看「${cat.name}」的流水，共 ${fmtMoney0(cat.total)}，佔 ${pct}%`}
                  >
                    <span className="rf-pie-legend-left">
                      <span className="rf-pie-legend-dot" style={{ background: CAT_COLORS[cat.id] ?? "#94a3b8" }} />
                      <span className="rf-pie-legend-name">{cat.name}</span>
                    </span>
                    <span className="rf-pie-legend-right">
                      <span className="rf-pie-legend-amount money">{fmtMoney0(cat.total)}</span>
                      <span className="rf-pie-legend-pct">{pct}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      {/* 3. 商家 Top-N（B 票的建議卡 CTA 導到 /reflect#merchants，這個 id 不能拿掉） */}
      <section className="card dashboard-card rf-card rf-card--merchant" aria-label="消費最多商家" id="merchants">
        <CardHead
          eyebrow="商家 Top-N"
          title="消費最多商家"
          description={
            topMerchantThisMonth
              ? `本月最常消費的是「${topMerchantThisMonth.name}」，共 ${fmtMoney0(
                  topMerchantThisMonth.total,
                )}（${topMerchantThisMonth.count} 筆）。`
              : insightsState.status === "loading"
                ? "載入中…"
                : "本月還沒有支出紀錄。"
          }
        />
        {merchantList.length > 0 ? (
          <div className="rf-merchant-list">
            {merchantList.map((m, i) => (
              <button
                type="button"
                className="rf-merchant-row"
                key={m.name}
                onClick={goToMerchants}
                aria-label={`看「${m.name}」所在的這個月流水`}
              >
                <span className="rf-merchant-rank">{i + 1}</span>
                <div className="rf-merchant-info">
                  <span className="rf-merchant-name">{m.name}</span>
                  <span className="rf-merchant-meta">{m.count} 筆</span>
                </div>
                <strong className="rf-merchant-amount">{fmtMoney0(m.total)}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* 4. burn rate／節奏 */}
      <section className="card dashboard-card rf-card rf-card--pace" aria-label="花費節奏">
        <CardHead
          eyebrow="花費節奏"
          title="收支步調"
          description={
            insightsState.status === "loaded"
              ? burnRateLabel(insightsState.data.burn_rate)
              : insightsState.status === "error"
                ? "節奏資料讀取失敗，稍後再試。"
                : "載入中…"
          }
        />
        {insightsState.status === "loaded" ? (
          <>
            <div className="rf-burn-row">
              <span className="rf-stat-label">日均花費</span>
              <strong className="rf-stat-value">{fmtMoney0(insightsState.data.daily_avg_this_month)}</strong>
            </div>
            {/* 原總覽頁 PaceSection 的實際累計／理想預算折線，併進這張卡，跟 burn_rate 是同一個
                「步調」概念，不再讓總覽跟分析頁各擺一份。沒有可畫的每日資料才退回原本的單一進度條
                （門檻沿用 burnRateProgressClass，跟 riskStatus 語意不同見 utils/insights.ts 註解）。 */}
            {overview && overview.pace.length > 0 ? (
              <>
                <PaceChart pace={overview.pace} />
                <div className="chart-legend" aria-label="圖例">
                  <span className="chart-legend-item">
                    <span className="chart-legend-line chart-legend-line--actual" aria-hidden="true" />
                    實際累計
                  </span>
                  <span className="chart-legend-item">
                    <span className="chart-legend-line chart-legend-line--pace" aria-hidden="true" />
                    理想預算
                  </span>
                </div>
              </>
            ) : (
              <div className="progress-track" style={{ marginTop: "var(--space-sm)" }}>
                <div
                  className={`progress-fill${burnRateProgressClass(insightsState.data.burn_rate)}`}
                  style={{ width: `${clampPct((insightsState.data.burn_rate ?? 0) * 100)}%` }}
                />
              </div>
            )}
          </>
        ) : null}
      </section>

      {/* 近三月趨勢：lp-analysis 原本就有的圖表，搬過來但沒有硬塞進上面四張卡（各圖一卡）。 */}
      {trendData.chartData.length > 0 ? (
        <section className="card dashboard-card rf-card rf-card--trend" aria-label="近三月趨勢">
          <CardHead
            eyebrow="趨勢"
            title="近三月趨勢"
            description={
              monthComparison
                ? `跟上個月比，${monthComparison.pctChange > 0 ? "多花了" : monthComparison.pctChange < 0 ? "少花了" : "差不多"} ${Math.abs(
                    monthComparison.pctChange,
                  ).toFixed(1)}%。`
                : "分類別的月度趨勢。"
            }
          />
          <div className="rf-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData.chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: "var(--ink-3)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                />
                <YAxis
                  tickFormatter={(v: number) => {
                    if (v >= 10000) return `${(v / 10000).toFixed(1)}萬`;
                    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
                    return String(v);
                  }}
                  tick={{ fill: "var(--ink-3)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip content={<TrendTooltip catNames={catNameMap} />} />
                {trendData.allCats.map((cat) => (
                  <Bar key={cat} dataKey={cat} stackId="a" fill={CAT_COLORS[cat] ?? "#94a3b8"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {insightsState.status !== "loading" &&
      categoryStats.length === 0 &&
      merchantList.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon" aria-hidden="true">
            <PieChartIcon size={22} strokeWidth={1.8} />
          </div>
          <h3 className="empty-state-title">這個月還沒有支出紀錄</h3>
          <p className="empty-state-description">
            記錄更多交易後，這裡會顯示分類圓餅、商家排行與趨勢。
          </p>
          <div className="empty-state-action">
            <NavLink className="primary-action" to="/capture">
              <Receipt size={16} aria-hidden="true" />
              去記一筆
            </NavLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}
