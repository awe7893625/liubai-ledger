// Pure ledger presentation logic. Amounts stay in integer minor units.
export type LedgerRow = {
  id: string;
  amount_minor: number | null;
  currency: string;
  occurred_at: string;
  status: string;
  merchant?: string | null;
  card_label?: string | null;
  category_id?: string | null;
  account_id?: string | null;
  note?: string | null;
  source?: string;
  legacy_date?: string | null;
  legacy_kind?: string | null;
};

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
});

export function ledgerDay(row: Pick<LedgerRow, "occurred_at" | "legacy_date">): string {
  if (row.legacy_date && /^\d{4}-\d{2}-\d{2}$/.test(row.legacy_date)) return row.legacy_date;
  const date = new Date(row.occurred_at);
  if (Number.isNaN(date.getTime())) return "";
  const parts = calendar.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function currentMonth(now = new Date()): string {
  return ledgerDay({ occurred_at: now.toISOString() }).slice(0, 7);
}

export function summarizeMonth(rows: LedgerRow[], month: string, currency = "TWD") {
  const summary = { expense: 0, income: 0, refund: 0, transfers: 0, confirmed: 0, pending: 0 };
  for (const row of rows) {
    if (ledgerDay(row).slice(0, 7) !== month || row.currency.trim() !== currency) continue;
    if (row.status !== "confirmed" || row.amount_minor === null) {
      if (row.status === "pending") summary.pending += 1;
      continue;
    }
    summary.confirmed += 1;
    if (row.legacy_kind === "transfer") { summary.transfers += 1; continue; }
    if (row.legacy_kind === "refund") { summary.refund += row.amount_minor; continue; }
    if (row.amount_minor < 0) summary.expense -= row.amount_minor;
    else summary.income += row.amount_minor;
  }
  return summary;
}

export function filterLedger<T extends LedgerRow>(
  rows: T[], month: string, search: string,
  accounts: Map<string, { name: string }>, categories: Map<string, { name: string }>,
): T[] {
  const query = search.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
  return rows.filter((row) => {
    if (month && ledgerDay(row).slice(0, 7) !== month) return false;
    const haystack = [row.merchant, row.card_label, row.note,
      accounts.get(row.account_id ?? "")?.name, categories.get(row.category_id ?? "")?.name,
    ].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase("zh-TW");
    return !query || haystack.includes(query);
  });
}

// CSV is data, never an Excel formula. Guard formulas even after leading whitespace.
function csvCell(value: unknown, numeric = false): string {
  let cell = String(value ?? "");
  if (!numeric && /^[\s\uFEFF]*[=+@-]/.test(cell)) cell = "'" + cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function ledgerCsv(
  rows: LedgerRow[], accounts: Map<string, { name: string }>, categories: Map<string, { name: string }>,
): string {
  const headers = ["日期", "商家／項目", "金額", "幣別", "帳戶", "分類", "狀態", "來源", "類型", "備註", "交易編號"];
  const lines = [headers.map((v) => csvCell(v)).join(",")];
  for (const row of rows) {
    const values = [ledgerDay(row), row.merchant, row.amount_minor === null ? "" : (row.amount_minor / 100).toFixed(2),
      row.currency, accounts.get(row.account_id ?? "")?.name ?? row.card_label,
      categories.get(row.category_id ?? "")?.name ?? "未分類", row.status, row.source,
      row.legacy_kind ?? (row.amount_minor !== null && row.amount_minor < 0 ? "expense" : "income"), row.note, row.id];
    lines.push(values.map((value, index) => csvCell(value, index === 2)).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export type LedgerPage<T> = { rows: T[]; total: number };

// Never present a partial page as the user's complete ledger. Fail visibly instead.
export async function loadAllLedgerPages<T extends { id: string }>(
  fetchPage: (offset: number, size: number) => Promise<LedgerPage<T>>,
  pageSize = 500, maximum = 50000,
): Promise<T[]> {
  const first = await fetchPage(0, pageSize);
  if (!Number.isInteger(first.total) || first.total < 0 || first.total > maximum) {
    throw new Error("帳本筆數超出本版可載入範圍，未顯示不完整總額。請聯絡支援。");
  }
  const rows = [...first.rows];
  for (let offset = pageSize; offset < first.total; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    if (page.total !== first.total) throw new Error("交易在載入期間有變動，請重新整理。");
    rows.push(...page.rows);
  }
  if (rows.length !== first.total || new Set(rows.map((row) => row.id)).size !== first.total) {
    throw new Error("交易未完整載入，請重新整理；不會將部分資料當成完整帳本。");
  }
  return rows;
}

export function retryRequest<T>(
  previous: { fingerprint: string; requestId: string; body: T } | null,
  body: T, createId: () => string,
) {
  const fingerprint = JSON.stringify(body);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: createId(), body };
}
