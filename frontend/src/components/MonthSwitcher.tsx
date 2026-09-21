// MonthSwitcher — 月份切換器（‹ 2026年9月 ›），點標籤可開月份選擇器直接跳月。
// 由 LedgerPage 抽出共用：流水頁＋分析頁共用同一顆，樣式走既有 .month-switcher。
import { ChevronLeft, ChevronRight } from "lucide-react";

export function shiftMonth(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${match[1]}年${Number(match[2])}月`;
}

export function MonthSwitcher({
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
      <span
        className="month-switcher-label"
        aria-live="polite"
        title="點一下直接選月份"
        style={{ cursor: "pointer" }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "month";
          input.value = month;
          input.style.position = "fixed";
          input.style.opacity = "0";
          input.style.pointerEvents = "none";
          const apply = () => {
            if (input.value && input.value !== month) onChange(input.value);
            input.remove();
          };
          input.addEventListener("change", apply);
          input.addEventListener("blur", apply);
          document.body.appendChild(input);
          if (input.showPicker) {
            try {
              input.showPicker();
            } catch {
              input.click();
            }
          } else {
            input.click();
          }
        }}
      >
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
