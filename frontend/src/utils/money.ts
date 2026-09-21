/** Format minor units (cents) as a currency string. null renders as an em dash. */
export function formatMinor(minor: number | null | undefined): string {
   if (minor === null || minor === undefined) return "—";
   const negative = minor < 0;
   const abs = Math.abs(minor);
   const whole = Math.floor(abs / 100);
   const cents = (abs % 100).toString().padStart(2, "0");
   const s = `${whole.toLocaleString("en-US")}.${cents}`;
   return negative ? `-$${s}` : `$${s}`;
}

export function clampPct(pct: number | null | undefined): number {
   if (pct === null || pct === undefined || Number.isNaN(pct)) return 0;
   return Math.max(0, Math.min(100, pct));
}

export type RiskKey = "ok" | "warn" | "over" | "none";

/** Budget risk as text + key (status must not be color-only). */
export function riskStatus(
   pct: number | null | undefined,
   over: boolean
): { key: RiskKey; label: string } {
   if (pct === null || pct === undefined) return { key: "none", label: "無限額" };
   if (over || pct >= 100) return { key: "over", label: "可能超支" };
   if (pct >= 80) return { key: "warn", label: "接近上限" };
   return { key: "ok", label: "正常" };
}

/**
 * 金額語義 class（視覺規格 2026-09-02）：0/null 顯示中性灰（禁紅綠），
 * 非零才分支出（danger）／收入（success）。帶符號金額用。
 */
export function flowMoneyClass(amount: number | null | undefined): string {
   if (
      amount === null ||
      amount === undefined ||
      !Number.isFinite(amount) ||
      amount === 0
   ) {
      return "money money-zero";
   }
   return amount < 0 ? "money money-expense" : "money money-income";
}

/** 總計欄位（支出總額／收入總額等語義已在欄位名）：0 → 中性灰。 */
export function totalMoneyClass(
   amount: number,
   direction: "expense" | "income"
): string {
   if (!Number.isFinite(amount) || amount === 0) return "money money-zero";
   return direction === "expense" ? "money money-expense" : "money money-income";
}
