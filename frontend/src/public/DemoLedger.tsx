import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Plus,
  RefreshCcw,
  WalletCards,
  PieChart,
  List,
  ArrowUpRight,
} from "lucide-react";
import type { FormEvent } from "react";
type Entry = {
  id: number;
  merchant: string;
  amount: number;
  category: string;
  day: string;
};
const seed: Entry[] = [
  {
    id: 13,
    merchant: "午餐便當",
    amount: 128,
    category: "餐飲",
    day: "09 / 21",
  },
  { id: 12, merchant: "晚餐", amount: 380, category: "餐飲", day: "09 / 20" },
  { id: 11, merchant: "咖啡店", amount: 85, category: "餐飲", day: "09 / 19" },
  {
    id: 10,
    merchant: "午餐便當",
    amount: 150,
    category: "餐飲",
    day: "09 / 18",
  },
  { id: 9, merchant: "書店", amount: 720, category: "學習", day: "09 / 17" },
  {
    id: 8,
    merchant: "網路月費",
    amount: 599,
    category: "帳單",
    day: "09 / 15",
  },
  {
    id: 7,
    merchant: "電影之夜",
    amount: 580,
    category: "娛樂",
    day: "09 / 13",
  },
  {
    id: 6,
    merchant: "朋友聚餐",
    amount: 880,
    category: "餐飲",
    day: "09 / 11",
  },
  {
    id: 5,
    merchant: "生活用品",
    amount: 520,
    category: "購物",
    day: "09 / 09",
  },
  {
    id: 4,
    merchant: "通勤交通",
    amount: 360,
    category: "交通",
    day: "09 / 07",
  },
  {
    id: 3,
    merchant: "線上課程",
    amount: 980,
    category: "學習",
    day: "09 / 05",
  },
  {
    id: 2,
    merchant: "週末超市採買",
    amount: 1280,
    category: "餐飲",
    day: "09 / 03",
  },
  {
    id: 1,
    merchant: "居家房租",
    amount: 11000,
    category: "居家",
    day: "09 / 01",
  },
];
const fmt = (v: number) =>
  new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(v);
export default function DemoLedger() {
  const [entries, setEntries] = useState(seed);
  const [tab, setTab] = useState("總覽");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("餐飲");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const spent =
    entries.reduce((s, e) => s + Math.round(e.amount * 100), 0) / 100;
  const groups = Object.entries(
    entries.reduce<Record<string, number>>((a, e) => {
      a[e.category] = (a[e.category] || 0) + e.amount;
      return a;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  function add(e: FormEvent) {
    e.preventDefault();
    const val = amount.trim();
    if (
      !/^\d+(\.\d{1,2})?$/.test(val) ||
      Number(val) <= 0 ||
      Number(val) > 1000000 ||
      !merchant.trim()
    ) {
      setError(
        "請填寫商家與 0～1,000,000 之間、大於 0 的金額（最多兩位小數）。",
      );
      return;
    }
    setEntries([
      {
        id: Date.now(),
        merchant: merchant.trim(),
        amount: Number(val),
        category,
        day: "剛剛・示範新增",
      },
      ...entries,
    ]);
    setAmount("");
    setMerchant("");
    setError("");
    setMessage("已加入此分頁的示範資料。沒有送往伺服器。");
    setTab("流水");
  }
  return (
    <div className="lb-demo">
      <a href="/" className="lb-text-link">
        <ArrowLeft size={15} /> 回產品首頁
      </a>
      <div className="lb-demo-heading">
        <div>
          <span className="lb-eyebrow">INTERACTIVE DEMO</span>
          <h1>
            先感受一下，
            <br className="lb-mobile" />
            記帳可以多輕鬆。
          </h1>
          <p>
            這是精簡功能示範，不連接銀行或你的
            Ledger。資料只在本分頁記憶體中，重新整理即重設。
          </p>
        </div>
        <button
          type="button"
          className="lb-btn lb-btn-ghost"
          onClick={() => {
            setEntries(seed);
            setMessage("示範資料已重設。");
            setError("");
          }}
        >
          <RefreshCcw size={16} />
          重設示範
        </button>
      </div>
      <div className="lb-demo-notice">
        <Check size={15} />
        <span>所有帳目皆為虛構。請不要輸入私人資料或銀行帳密。</span>
      </div>
      <div className="lb-demo-tabs" role="tablist" aria-label="示範功能">
        {[
          ["總覽", PieChart],
          ["流水", List],
          ["記一筆", Plus],
        ].map(([name, Icon]) => {
          const I = Icon as typeof Plus;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={tab === name}
              key={String(name)}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(String(name))}
            >
              <I size={17} />
              {String(name)}
            </button>
          );
        })}
      </div>
      <p className="lb-demo-message" role="status">
        {message}
      </p>
      {tab === "總覽" && (
        <div className="lb-demo-grid">
          <section className="lb-demo-card lb-demo-budget">
            <span className="lb-eyebrow">2026 年 9 月・示範月份</span>
            <div className="lb-demo-value-label">
              本月剩餘預算 <WalletCards size={22} />
            </div>
            <strong className="lb-demo-number">NT$ {fmt(30000 - spent)}</strong>
            <p>本月預算 NT$30,000・已使用 {fmt((spent / 30000) * 100)}%</p>
            <div className="lb-demo-progress">
              <span
                style={{ width: `${Math.min(100, (spent / 30000) * 100)}%` }}
              />
            </div>
            <div className="lb-demo-substats">
              <span>
                本月支出<strong>NT$ {fmt(spent)}</strong>
              </span>
              <span>
                交易筆數<strong>{entries.length} 筆</strong>
              </span>
            </div>
            <button
              type="button"
              className="lb-btn lb-btn-primary"
              onClick={() => setTab("記一筆")}
            >
              <Plus size={16} />
              試著記一筆
            </button>
          </section>
          <section className="lb-demo-card">
            <h2>支出去哪裡</h2>
            <p>分類組成・隨示範記帳即時更新</p>
            <div className="lb-demo-categories">
              {groups.map(([cat, val]) => (
                <div key={cat}>
                  <header>
                    <span>{cat}</span>
                    <strong>NT$ {fmt(val)}</strong>
                  </header>
                  <div>
                    <span style={{ width: `${(val / spent) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {tab === "流水" && (
        <section className="lb-demo-card">
          <div className="lb-demo-list-head">
            <div>
              <h2>每一筆，都有紀錄。</h2>
              <p>示範月份共 {entries.length} 筆支出</p>
            </div>
            <button
              className="lb-btn lb-btn-primary"
              type="button"
              onClick={() => setTab("記一筆")}
            >
              <Plus size={15} />
              新增
            </button>
          </div>
          <div className="lb-demo-transactions">
            {entries.map((e) => (
              <div key={e.id}>
                <span className="lb-demo-avatar">{e.category.slice(0, 1)}</span>
                <div>
                  <strong>{e.merchant}</strong>
                  <small>
                    {e.day} · {e.category} · 日常卡
                  </small>
                </div>
                <span className="lb-demo-amount">− NT$ {fmt(e.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "記一筆" && (
        <section className="lb-demo-card lb-demo-form">
          <span className="lb-eyebrow">記一筆・精簡互動示範</span>
          <h2>剛剛花了多少？</h2>
          <form onSubmit={add}>
            <label htmlFor="demo-amount">金額（新台幣）</label>
            <input
              id="demo-amount"
              inputMode="decimal"
              placeholder="128"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoComplete="off"
            />
            <label htmlFor="demo-merchant">商家或用途</label>
            <input
              id="demo-merchant"
              placeholder="例如：示範咖啡店"
              value={merchant}
              maxLength={60}
              onChange={(e) => setMerchant(e.target.value)}
            />
            <label htmlFor="demo-category">分類</label>
            <select
              id="demo-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {[
                "餐飲",
                "交通",
                "居家",
                "購物",
                "娛樂",
                "學習",
                "帳單",
                "其他",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            {error && (
              <p className="lb-error" role="alert">
                {error}
              </p>
            )}
            <button className="lb-btn lb-btn-primary" type="submit">
              <Check size={17} />
              加入示範帳本
            </button>
            <p>只有這個分頁會更新，不會寫入任何私人帳本。</p>
          </form>
        </section>
      )}
      <div className="lb-demo-end">
        <span>想把它變成自己的帳本？</span>
        <a className="lb-btn lb-btn-light" href="/#guide">
          照教學部署與安裝捷徑 <ArrowUpRight size={16} />
        </a>
      </div>
    </div>
  );
}
