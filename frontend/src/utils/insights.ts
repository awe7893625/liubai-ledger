// insights.ts — 單一資料源：包一層 api.getInsights() + 給 UI 用的衍生值/格式化。
// AssistantPage（B 票）與 ReflectPage（C 票）都吃這支，禁止兩邊各自算一套。

import { useEffect, useState } from "react";
import { api } from "../api";

export type InsightsData = {
  daily_avg_this_month: number;
  total_spent_minor: number;
  category_totals: { category_id: string; name: string; total_minor: number; count: number }[];
  account_totals: { account_id: string; name: string; total_minor: number; count: number }[];
  category_trend: Record<string, Record<string, number>>;
  top_merchants: { merchant: string; total_minor: number; count: number }[];
  burn_rate: number | null;
  budget_configured: boolean;
  window: { month: string; start: string; end: string };
};

export type InsightsState =
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: InsightsData; error: null }
  | { status: "error"; data: null; error: string };

/**
 * 唯一的 insights 讀取點；元件只管顯示，不重覆 fetch 邏輯。
 * month 省略＝當月（ReflectPage／AssistantPage 用法）；總覽頁有月份切換器，
 * 帶入 selectedMonth 才不會讓 Hero 的洞察句跟畫面上顯示的月份對不上。
 */
export function useInsights(month?: string): InsightsState {
  const [state, setState] = useState<InsightsState>({
    status: "loading",
    data: null,
    error: null,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onDataChanged = () => setRevision((value) => value + 1);
    window.addEventListener("ledger:data-changed", onDataChanged);
    return () => window.removeEventListener("ledger:data-changed", onDataChanged);
  }, []);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading", data: null, error: null });
    api
      .getInsights(month)
      .then((data) => {
        if (alive) setState({ status: "loaded", data, error: null });
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({
            status: "error",
            data: null,
            error: err instanceof Error ? err.message : "insights 讀取失敗",
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [month, revision]);

  return state;
}

/** 與 App.tsx / LedgerPage 一致的 NT$ 格式（minor units → 字串）。 */
export function formatMoneyMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  const sign = minor < 0 ? "−" : "";
  return `${sign}NT$${Math.round(Math.abs(minor) / 100).toLocaleString("zh-TW")}`;
}

/** 消費最多的商家（後端已依 total_minor 排序，取第一筆）。 */
export function topMerchant(
  insights: InsightsData | null,
): InsightsData["top_merchants"][number] | null {
  return insights?.top_merchants?.[0] ?? null;
}

/**
 * 消費最多的前 N 名商家，正規化成 UI 慣用欄位名（name/total/count）。
 * ReflectPage 的商家卡吃這支，不再自己 reduce items 算一套。
 */
export function topMerchants(
  insights: InsightsData | null,
  n: number,
): { name: string; total: number; count: number }[] {
  if (!insights) return [];
  return insights.top_merchants.slice(0, n).map((m) => ({
    name: m.merchant,
    total: m.total_minor,
    count: m.count,
  }));
}

/** 該月天數（供推算月底累積花費用）。 */
export function daysInMonth(monthStr: string): number {
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

/** 依目前日均花費速度，推算月底會花到多少（不依賴預算，純速度外推）。 */
export function projectedMonthEndSpend(
  insights: InsightsData | null,
  monthStr: string,
): number | null {
  if (!insights) return null;
  return Math.round(insights.daily_avg_this_month * daysInMonth(monthStr));
}

/** burn_rate 轉人話：>1 代表比預算步調快，<1 代表慢。 */
export function burnRateLabel(burnRate: number | null | undefined): string {
  if (burnRate === null || burnRate === undefined || !Number.isFinite(burnRate)) {
    return "資料不足";
  }
  if (burnRate > 1.1) return `目前花費速度比預算步調快 ${Math.round((burnRate - 1) * 100)}%`;
  if (burnRate < 0.9) return `目前花費速度比預算步調慢 ${Math.round((1 - burnRate) * 100)}%`;
  return "目前花費速度大致符合預算步調";
}

/**
 * burn_rate 進度條門檻（>1.1 明顯超前＝over／>1.0 略超前＝warn），從 ReflectPage 搬過來，
 * 門檻值不變。不沿用 money.ts 的 riskStatus：那支語意是「預算已用百分比」，量綱不同，
 * 硬套會把「步調偏慢」誤標成警示。
 */
export function burnRateProgressClass(burnRate: number | null | undefined): string {
  if (burnRate === null || burnRate === undefined || !Number.isFinite(burnRate)) return "";
  if (burnRate > 1.1) return " progress-fill--over";
  if (burnRate > 1.0) return " progress-fill--warn";
  return "";
}

/**
 * insights.window 轉成人話時間窗描述，供文案用（例如助理頁的商家建議卡）。
 * 是當月就講「本月」，否則講「YYYY 年 M 月」——不再讓文案寫死一個跟資料窗口對不上的期間。
 */
export function windowLabel(insights: InsightsData | null): string {
  if (!insights) return "本月";
  const match = /^(\d{4})-(\d{2})$/.exec(insights.window.month);
  if (!match) return "本月";
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (insights.window.month === currentMonth) return "本月";
  return `${match[1]} 年 ${Number(match[2])} 月`;
}

/** category_trend 的月份 key 由後端回傳未排序，取排序後清單供比較/圖表使用。 */
export function categoryTrendMonths(insights: InsightsData | null): string[] {
  if (!insights) return [];
  return Object.keys(insights.category_trend).sort();
}
