// HomeAssistantPage — 首頁 AI 助理一體化（user 定案：在家直接叫出 AI 助理）。
// 一個對話框搞定記帳＋問答：
//   記帳意圖（含數字、非問句）→ /api/ai/parse 解析 → 氣泡上直接「入帳」送出，
//   不跳表單（CapturePage 的手動表單仍是進階備援，在 /capture）。
//   問句（無數字）→ /api/ai/ask 純文字回答（後端先算好統計，模型只講人話）。
//   有數字的問句例外：以問號／疑問詞優先判為問答（P0-2 教訓：中文意圖判定要雙向守門）。
// 頂部小卡顯示「今天可花」（safe_to_spend_today_minor），讓開 APP 就有答案。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Camera,
  ImageIcon,
  Loader2,
  Mic,
  Sparkles,
  Square,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { Transaction } from "../types";
import { useStore } from "../store/useStore";

// ---------- 型別 ----------

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: { length: number; [i: number]: { [0]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type AiParseResult = {
  ok: boolean;
  engine?: string;
  error?: string;
  amount_minor?: number;
  kind?: "expense" | "income";
  date?: string;
  merchant?: string;
  category?: string;
  account?: string | null;
  notes?: string;
};

type HomeMsg = {
  id: string;
  role: "user" | "ai";
  text: string;
  image?: string;
  /** ai 訊息帶解析結果 → 顯示確認列（入帳／改明細） */
  parsed?: AiParseResult;
  /** 已入帳的 tx id（避免重複送出） */
  postedTxId?: string;
};

type Intent = "txn" | "ask";
type IntentMode = "auto" | Intent;

const QUICK_CHIPS = ["本月會超支嗎？", "上週外食多少？", "本月 Top 商家", "早餐 65 超商"];
const ACCOUNT_LABELS: Record<string, string> = {
  cash: "現金",
  unknown: "未指定卡片",
};
const CATEGORY_LABELS: Record<string, string> = {
  c_food: "餐飲",
  c_transport: "交通",
  c_home: "居家",
  c_shopping: "購物",
  c_fun: "娛樂",
  c_health: "健康",
  c_education: "教育",
  c_bills: "公共事業",
  c_travel: "旅遊",
  c_other: "其他",
};

/**
 * 意圖分流（與 225441e 修後版同構，雙向守門）：
 * 含數字且無疑問詞／疑問標點＝記帳；其餘＝問答。
 * 「這個月花了多少錢」有數字但有疑問詞 → 問答，正確。
 */
function detectIntent(text: string): Intent {
  const hasDigit = /\d/.test(text);
  const looksQuestion = /[？?]|多少|幾|哪裡|哪些|為什麼|嗎|怎麼|分析|統計|排行/.test(text);
  if (hasDigit && !looksQuestion) return "txn";
  return "ask";
}

function parseSummary(r: AiParseResult): string {
  const dir = r.kind === "income" ? "收入" : "支出";
  const amt =
    r.amount_minor != null
      ? `NT$${(Math.abs(r.amount_minor) / 100).toLocaleString("zh-TW")}`
      : "—";
  const parts = [`${dir} ${amt}`];
  if (r.merchant) parts.push(r.merchant);
  if (r.category) parts.push(CATEGORY_LABELS[r.category] ?? r.category);
  if (r.account) parts.push(ACCOUNT_LABELS[r.account] ?? r.account);
  if (r.date) parts.push(r.date);
  return parts.join("・");
}

/** 只把 **bold** 轉 strong，其餘原樣（防 XSS，同 AssistantPage 做法）。 */
function renderInlineBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? <strong key={i}>{bold[1]}</strong> : <span key={i}>{part}</span>;
  });
}

// ---------- 頁面 ----------

export function HomeAssistantPage() {
  const navigate = useNavigate();
  const pushToast = useStore((s) => s.pushToast);

  const month = useMemo(() => new Date().toISOString().slice(0, 7), []);

  // 今天可花（overview 只讀 selectedMonth，這裡獨立打一次當月，不動全域 store）
  const [safeToday, setSafeToday] = useState<number | null>(null);
  const [safeLoading, setSafeLoading] = useState(true);

  const [msgs, setMsgs] = useState<HomeMsg[]>([]);
  const [input, setInput] = useState("");
  const [intentMode, setIntentMode] = useState<IntentMode>("auto");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    setSafeLoading(true);
    api
      .getOverview(month)
      .then((o) => {
        if (alive) setSafeToday(o.safe_to_spend_today_minor);
      })
      .catch(() => {
        if (alive) setSafeToday(null);
      })
      .finally(() => {
        if (alive) setSafeLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [month]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const pushMsg = (m: HomeMsg) => setMsgs((prev) => [...prev, m]);
  const resolveIntent = (text: string): Intent =>
    intentMode === "auto" ? detectIntent(text) : intentMode;

  // 記帳：解析 → 掛結果氣泡（使用者按「入帳」才 POST）
  const parseTxn = (payload: { text?: string; image_b64?: string }, image?: string) => {
    setBusy(true);
    api
      .aiParse(payload)
      .then((r: AiParseResult) => {
        if (r.ok && r.amount_minor != null) {
          pushMsg({
            id: crypto.randomUUID(),
            role: "ai",
            text: parseSummary(r),
            image,
            parsed: r,
          });
        } else {
          pushMsg({
            id: crypto.randomUUID(),
            role: "ai",
            text: r.error ? `解析失敗：${r.error}` : "沒抓到金額，再說一次或改用表單。",
            image,
          });
        }
      })
      .catch((err: unknown) =>
        pushMsg({
          id: crypto.randomUUID(),
          role: "ai",
          text: `AI 連線失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
          image,
        }),
      )
      .finally(() => setBusy(false));
  };

  // 問答：/api/ai/ask
  const askAi = (question: string) => {
    setBusy(true);
    api
      .aiAsk(question, month)
      .then((r) => {
        pushMsg({
          id: crypto.randomUUID(),
          role: "ai",
          text: r.ok && r.answer ? r.answer : r.error ? `後端回應錯誤：${r.error}` : "助理暫時回答不出來，換個問法試試",
        });
      })
      .catch((err: unknown) =>
        pushMsg({
          id: crypto.randomUUID(),
          role: "ai",
          text: `助理連線失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
        }),
      )
      .finally(() => setBusy(false));
  };

  // 入帳（確認列按鈕）——口徑同 CaptureForm submit（amount 負＝支出）。
  // 帳戶沿用上次使用的（與 CaptureForm 同一 localStorage key），沒有才落 cash。
  const postTxn = (m: HomeMsg, r: AiParseResult) => {
    if (r.amount_minor == null || m.postedTxId) return;
    const signed = r.kind === "income" ? r.amount_minor : -r.amount_minor;
    let account = r.account ?? "cash";
    try {
      account = r.account ?? window.localStorage.getItem("ledger.capture.lastAccountId") ?? "cash";
    } catch {
      /* private mode 等，忽略 */
    }
    setBusy(true);
    api
      .createTransaction({
        funding_account_id: account,
        amount: signed,
        currency: "TWD",
        date: r.date ?? new Date().toISOString().slice(0, 10),
        description: r.notes || r.merchant || null,
        merchant: r.merchant || null,
        merchant_normalized: r.merchant || null,
        category_id: r.category ?? null,
        source: "manual",
        status: "confirmed",
      })
      .then((tx: Transaction) => {
        setMsgs((prev) =>
          prev.map((row) =>
            row.id === m.id
              ? { ...row, postedTxId: tx.id, text: `${row.text} — ✅ 已入帳` }
              : row,
          ),
        );
        pushToast("success", "已入帳");
        setSafeToday(null); // 標記待重算
        setSafeLoading(true);
        api
          .getOverview(month)
          .then((o) => setSafeToday(o.safe_to_spend_today_minor))
          .catch(() => undefined)
          .finally(() => setSafeLoading(false));
      })
      .catch((err: unknown) =>
        pushToast("error", `入帳失敗：${err instanceof Error ? err.message : "未知錯誤"}`),
      )
      .finally(() => setBusy(false));
  };

  const submitText = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    pushMsg({ id: crypto.randomUUID(), role: "user", text });
    if (resolveIntent(text) === "txn") parseTxn({ text });
    else askAi(text);
  };

  // 照片：壓 1280px（同 CapturePage 配方）
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1280 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL("image/jpeg", 0.85);
        pushMsg({ id: crypto.randomUUID(), role: "user", text: "[收據照片]", image: b64 });
        parseTxn({ image_b64: b64 }, b64);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const toggleVoice = () => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      pushToast("error", "此瀏覽器不支援語音輸入（iOS 請用 Safari）");
      return;
    }
    const recog = new Ctor();
    recog.lang = "zh-TW";
    recog.continuous = false;
    recog.interimResults = false;
    recog.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, i) =>
        event.results[i][0].transcript,
      ).join(" ");
      if (!transcript.trim()) return;
      pushMsg({ id: crypto.randomUUID(), role: "user", text: `🎙️ ${transcript.trim()}` });
      const text = transcript.trim();
      if (resolveIntent(text) === "txn") parseTxn({ text });
      else askAi(text);
    };
    recog.onerror = () => setListening(false);
    recog.onend = () => setListening(false);
    recogRef.current = recog;
    setListening(true);
    recog.start();
  };

  return (
    <div className="dashboard-content summary-stack">
      <header className="page-header">
        <p className="page-kicker">助理</p>
        <h1 className="page-title">今天可花 {safeLoading && safeToday === null ? "…" : safeToday != null ? `NT$${(Math.abs(safeToday) / 100).toLocaleString("zh-TW")}` : "—"}</h1>
        <p className="page-subtitle">說一句、拍一張就記好；想問錢花去哪，直接問。</p>
      </header>

      <section className="card assistant-card" aria-label="AI 助理對話">
        <div className="assistant-thread" ref={listRef} aria-live="polite">
          {msgs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <Sparkles size={22} strokeWidth={1.8} />
              </div>
              <h3 className="empty-state-title">說一句就記好</h3>
              <p className="empty-state-description">
                「午餐 120 現金」會記帳、「這個月花在哪」會分析；也可以直接拍收據。
              </p>
            </div>
          ) : null}
          {msgs.map((m) => (
            <div key={m.id} className={`assistant-msg assistant-msg--${m.role}`}>
              {m.image ? <img src={m.image} alt="收據" className="ai-msg-img" /> : null}
              <div className="assistant-bubble">{renderInlineBold(m.text)}</div>
              {m.role === "ai" && m.parsed && !m.postedTxId ? (
                <div className="home-confirm-row">
                  <button
                    type="button"
                    className="primary-action"
                    disabled={busy}
                    onClick={() => postTxn(m, m.parsed as AiParseResult)}
                  >
                    入帳
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => navigate("/ledger")}
                  >
                    去流水看
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {busy ? (
            <div className="assistant-msg assistant-msg--ai">
              <div className="assistant-bubble assistant-bubble--inline">
                <Loader2 size={14} className="assistant-spin" aria-hidden="true" /> 助理處理中…
              </div>
            </div>
          ) : null}
        </div>

        <div className="assistant-mode-row" role="group" aria-label="AI 助理模式">
          {([
            ["auto", "智能"],
            ["ask", "問帳務"],
            ["txn", "AI 記帳"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className="assistant-mode-btn"
              aria-pressed={intentMode === mode}
              disabled={busy}
              onClick={() => setIntentMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="assistant-mode-hint">
          {intentMode === "auto"
            ? "智能判斷：問句會分析帳務，有金額的敘述會先解析成待確認記帳。"
            : intentMode === "ask"
              ? "問帳務模式：不會建立交易，只回答你的帳務問題。"
              : "AI 記帳模式：把你說的內容解析成交易，確認後才會入帳。"}
        </p>

        <div className="assistant-chip-row">
          {QUICK_CHIPS.map((q) => (
            <button
              key={q}
              type="button"
              className="chip-btn"
              disabled={busy}
              onClick={() => {
                pushMsg({ id: crypto.randomUUID(), role: "user", text: q });
                if (resolveIntent(q) === "txn") parseTxn({ text: q });
                else askAi(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="ai-input-row">
          <textarea
            ref={textareaRef}
            className="ai-input"
            placeholder={listening ? "聆聽中…" : "說一句，例如：午餐 120 現金"}
            rows={2}
            value={input}
            disabled={busy}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitText();
              }
            }}
          />
          <div className="ai-input-btn-row">
            <button
              type="button"
              className="icon-button"
              aria-label="從相簿選收據"
              disabled={busy}
              onClick={() => galleryRef.current?.click()}
            >
              <ImageIcon size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="拍收據"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? <Loader2 size={19} className="lp-spin" aria-hidden="true" /> : <Camera size={19} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={`icon-button${listening ? " icon-button--active" : ""}`}
              aria-label={listening ? "停止語音" : "語音輸入"}
              onClick={toggleVoice}
            >
              {listening ? <Square size={19} aria-hidden="true" /> : <Mic size={19} aria-hidden="true" />}
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="icon-button ai-send"
              aria-label="送出"
              disabled={busy || !input.trim()}
              onClick={submitText}
            >
              <ArrowUpRight size={19} aria-hidden="true" />
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </section>
    </div>
  );
}
