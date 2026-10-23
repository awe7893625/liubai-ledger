// Deterministic, read-only ledger tools. No network, model, or mutations.
import { currentMonth, ledgerDay } from "./ledger-data.ts";
import type { LedgerRow } from "./ledger-data.ts";
export type Named = { id: string; name: string; currency?: string };
export type Period = { start: string; end: string; label: string };
export type LedgerAnswer = {
  question: string; period: Period; currency: string; expense: number; income: number;
  refunds: number; netExpense: number; rows: LedgerRow[]; ignored: number;
  merchants: { name: string; amount: number; count: number }[]; latestDay: string;
  kind: "summary" | "merchants"; category: string | null; account: string | null;
};
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
const dayAt = (date: Date) => date.toISOString().slice(0, 10);
const shift = (day: string, days: number) => dayAt(new Date(Date.parse(day + "T12:00:00Z") + days * 86400000));
export function validDay(value: string): boolean {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && dayAt(date) === value;
}
function monthPeriod(month: string): Period {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("請選擇有效月份。");
  const [year, index] = month.split("-").map(Number);
  return { start: month + "-01", end: dayAt(new Date(Date.UTC(year, index, 0, 12))), label: month };
}
export function queryPeriod(text: string, selectedMonth: string, now = new Date()): Period {
  const today = ledgerDay({ occurred_at: now.toISOString() });
  const month = currentMonth(now);
  const explicit = text.match(/20\d{2}-(?:0[1-9]|1[0-2])(?:-\d{2})?/g) || [];
  if (explicit.length > 1) throw new Error("一次請查詢一個日期或月份。");
  const ranges = [/(今天|今日)/, /(昨天|昨日)/, /(上週|上周)/, /(本週|這週|本周|這周)/, /(上月|上個月)/, /(本月|這個月|這月)/, /目前月份/];
  if (ranges.filter((pattern) => pattern.test(text)).length + explicit.length > 1) throw new Error("請只指定一個時間範圍。");
  const explicitDate = explicit[0];
  if (explicitDate) {
    if (explicitDate.length === 10) {
      if (!validDay(explicitDate)) throw new Error("查詢日期不存在。");
      return { start: explicitDate, end: explicitDate, label: explicitDate };
    }
    return monthPeriod(explicitDate);
  }
  if (/(今天|今日)/.test(text)) return { start: today, end: today, label: "今天" };
  if (/(昨天|昨日)/.test(text)) { const day = shift(today, -1); return { start: day, end: day, label: "昨天" }; }
  if (/(上週|上周|本週|這週|本周|這周)/.test(text)) {
    const weekday = new Date(today + "T12:00:00Z").getUTCDay();
    const monday = shift(today, -((weekday + 6) % 7));
    const start = shift(monday, /(上週|上周)/.test(text) ? -7 : 0);
    return { start, end: shift(start, 6), label: /(上週|上周)/.test(text) ? "上週（週一至週日）" : "本週（週一至週日）" };
  }
  if (/(上月|上個月)/.test(text)) return monthPeriod(shift(month + "-01", -1).slice(0, 7));
  return monthPeriod(/(本月|這個月|這月)/.test(text) ? month : selectedMonth);
}
function extractName(text: string, items: Named[], kind: string): { rest: string; found: Named | null } {
  const candidates = items.filter((item) => item.name.trim() && text.includes(normalized(item.name)));
  // Overlapping names choose the most specific; independent names are ambiguous.
  const maximal = candidates.filter((a) => !candidates.some((b) => a.id !== b.id && normalized(b.name).includes(normalized(a.name)) && b.name.length > a.name.length));
  if (maximal.length > 1) throw new Error(`一次請查詢一個${kind}，不要混合多個名稱。`);
  const found = maximal[0] || null;
  return { rest: found ? text.replace(normalized(found.name), " ") : text, found };
}
export function answerLedger(question: string, rows: LedgerRow[], month: string, currency: string,
  categories: Named[], accounts: Named[], now = new Date()): LedgerAnswer {
  if (!question.trim() || question.length > 180) throw new Error("請輸入 180 字以內的帳務問題。");
  const text = normalized(question);
  if (!/(多少|花費|花了|支出|收入|退款|排行|排名|總額|合計|明細|統計)/.test(text)) throw new Error("目前支援支出、收入、退款與商家排行，例如「本月花多少」。");
  const period = queryPeriod(text, month, now);
  const account = extractName(text, accounts, "帳戶");
  const category = extractName(account.rest, categories, "分類");
  const remainder = category.rest
    .replace(/20\d{2}-\d{2}(?:-\d{2})?/g, " ")
    .replace(/今天|今日|昨天|昨日|上週|上周|本週|這週|本周|這周|上個月|上月|本月|這個月|這月|目前月份/g, " ")
    .replace(/商家排行|商家排名|排行|排名|商家|店家|總額|合計|明細|統計|支出|收入|退款|花多少|花了|花費|花|多少|總共|錢|金額|的|請問|請|幫我|查詢|查|看看|看|有|是|和|與|及/g, " ")
    .replace(/[\s?？。，,！!：:]/g, "");
  if (remainder) throw new Error("這個問法尚未支援。請使用自己的分類／帳戶完整名稱，或點選下方範例；不會猜測你的意思。");
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("請選擇幣別，不能混合加總。");
  const matched = rows.filter((row) => { const day = ledgerDay(row); return day >= period.start && day <= period.end && row.currency.trim() === currency && (!account.found || row.account_id === account.found.id) && (!category.found || row.category_id === category.found.id); });
  const eligible = matched.filter((row) => row.status === "confirmed" && row.amount_minor !== null && Number.isSafeInteger(row.amount_minor) && row.legacy_kind !== "transfer");
  let expense = 0; let income = 0; let refunds = 0;
  const merchants = new Map<string, { name: string; amount: number; count: number }>();
  for (const row of eligible) {
    const amount = row.amount_minor!;
    if (row.legacy_kind === "refund") { refunds += amount; continue; }
    if (amount >= 0) { income += amount; continue; }
    expense -= amount;
    const name = row.merchant?.trim() || "未填商家";
    const group = merchants.get(name) || { name, amount: 0, count: 0 };
    group.amount -= amount; group.count++; merchants.set(name, group);
  }
  if (![expense, income, refunds, expense - refunds].every(Number.isSafeInteger)) throw new Error("加總超出可安全計算範圍，未顯示估算數字。");
  return { question, period, currency, expense, income, refunds, netExpense: expense - refunds,
    rows: eligible, ignored: matched.length - eligible.length, latestDay: rows.map(ledgerDay).sort().slice(-1)[0] || "",
    merchants: [...merchants.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    kind: /排行|排名/.test(text) ? "merchants" : "summary", category: category.found?.name || null, account: account.found?.name || null };
}
export type QuickDraft = { amount: string; merchant: string; direction: "expense" | "income"; accountId: string | null; categoryId: string | null; day: string; original: string };
export function parseQuickDraft(input: string, categories: Named[], accounts: Named[], now = new Date()): QuickDraft {
  if (!input.trim() || input.length > 180) throw new Error("請輸入商家與一個金額，例如「午餐 120」。");
  let remaining = input.normalize("NFKC").trim();
  if (/[?？]|多少|為什麼|怎麼|排名|排行/.test(remaining)) throw new Error("這是問句，請使用查帳；不會建立交易。");
  if (/退款|轉帳|退貨/.test(remaining)) throw new Error("轉帳或退款請用交易表單確認類型，不會當作普通收入。");
  let day = ledgerDay({ occurred_at: now.toISOString() });
  const dates = remaining.match(/20\d{2}-\d{2}-\d{2}/g) || [];
  if (dates.length > 1 || (dates.length && /今天|昨天/.test(remaining))) throw new Error("請只指定一個日期。");
  const explicitDay = dates[0];
  if (explicitDay) { if (!validDay(explicitDay)) throw new Error("日期不存在。"); day = explicitDay; remaining = remaining.replace(day, " "); }
  else if (/昨天/.test(remaining)) day = shift(day, -1);
  remaining = remaining.replace(/今天|昨天/g, " ");
  const direction = /^收入\s*/.test(remaining) ? "income" : "expense";
  remaining = remaining.replace(/^(收入|支出)\s*/, "");
  const account = extractName(normalized(remaining), accounts, "帳戶");
  const category = extractName(account.rest, categories, "分類");
  // Only explicit exact names are removed. Never infer a bank from a fuzzy label.
  for (const item of [account.found, category.found]) if (item) remaining = remaining.replace(new RegExp(item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  const amounts = [...remaining.matchAll(/\d[\d,.]*/g)];
  if (amounts.length !== 1) throw new Error("請只填一個明確金額；店名或卡名含數字時，改用表單確認。");
  const raw = amounts[0][0];
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error("金額格式不正確，最多兩位小數。");
  const [whole, fraction = ""] = raw.replace(/,/g, "").split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("金額必須為安全範圍內的正數。");
  const amountIndex = amounts[0].index!;
  const before = remaining.slice(0, amountIndex).replace(/(?:NT\$|TWD|新台幣|台幣)\s*$/i, " ");
  const after = remaining.slice(amountIndex + raw.length).replace(/^\s*元(?=\s|$)/, " ");
  const merchant = `${before} ${after}`.replace(/\s+/g, " ").trim();
  if (!merchant || /[-+$€¥£]|USD|JPY|EUR|GBP|HKD|美元|日圓|歐元|港幣/i.test(merchant)) throw new Error("請確認商家與幣別；簡短輸入目前只處理台幣正數金額。");
  if (account.found?.currency && account.found.currency !== "TWD") throw new Error("這個帳戶不是台幣，請使用一般記帳表單。");
  return { amount: (minor / 100).toFixed(2), merchant, direction, accountId: account.found?.id || null, categoryId: category.found?.id || null, day, original: input };
}
export type GeoPoint = { lat: number; lng: number; label: string | null };
export function parseLedgerGeo(note: string | null | undefined): GeoPoint | null {
  if (!note || note.length > 10000) return null;
  let lat: unknown; let lng: unknown; let label: unknown = null;
  try {
    if (note.trim().startsWith("{")) {
      const parsed = JSON.parse(note); lat = parsed.latitude; lng = parsed.longitude; label = parsed.location_name || parsed.street;
    } else {
      const match = note.match(/🗺️?\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
      if (!match) return null;
      lat = match[1]; lng = match[2]; label = note.match(/📍\s*([^·\n]+)/)?.[1];
    }
  } catch { return null; }
  const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v.trim()));
  if (!numeric(lat) || !numeric(lng)) return null;
  const latitude = Number(lat); const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lng: longitude, label: typeof label === "string" ? label.trim().slice(0, 160) : null };
}
export function locatedExpenses(rows: LedgerRow[], month: string, currency: string) {
  return rows.flatMap((row) => {
    if ((month && ledgerDay(row).slice(0, 7) !== month) || row.currency.trim() !== currency || row.status !== "confirmed" || row.amount_minor === null || row.amount_minor >= 0 || row.legacy_kind === "transfer" || row.legacy_kind === "refund") return [];
    const geo = parseLedgerGeo(row.note); return geo ? [{ row, ...geo }] : [];
  });
}
