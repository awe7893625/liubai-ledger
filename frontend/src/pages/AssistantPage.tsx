// AssistantPage — 全站對話助理（B 票）。
// 只走 api.aiAsk(question, month)，不做記帳解析（記帳解析在 Capture 的 SmartFillCard）。
// 建議卡資料一律吃 utils/insights.ts 的共用來源，不在這裡另算一套。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { NavigateFunction } from "react-router-dom";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { api } from "../api";
import type { Transaction } from "../types";
import {
  burnRateLabel,
  formatMoneyMinor,
  projectedMonthEndSpend,
  topMerchant,
  useInsights,
  windowLabel,
  type InsightsData,
} from "../utils/insights";

const QUICK_CHIPS = [
  "本月會超支嗎？",
  "上週外食多少？",
  "本月 Top 商家",
  "這個月花最多的一天",
];

type SuggestionKind = "top-merchant" | "burn-rate";

type AssistantMsg = {
  id: string;
  role: "user" | "ai";
  text: string;
  suggestion?: SuggestionKind;
};

/** 從問句關鍵字判斷要不要附建議卡；判斷不到就不附，不硬塞。 */
function detectSuggestion(question: string): SuggestionKind | undefined {
  if (/商家|merchant|Top/i.test(question)) return "top-merchant";
  if (/超支|預算|燒錢|花光|花完|速度|步調/.test(question)) return "burn-rate";
  return undefined;
}

/**
 * 把訊息文字裡的 `**bold**` 轉成 <strong>，其餘原樣輸出。
 * 只處理這一種語法，不做完整 markdown、不裝套件、不用 dangerouslySetInnerHTML
 * （用 React 元素陣列組出來，天生防 XSS；換行交給 CSS 的 white-space: pre-wrap）。
 */
function renderInlineBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    return bold ? <strong key={i}>{bold[1]}</strong> : <span key={i}>{part}</span>;
  });
}

function SuggestionCard({
  kind,
  insights,
  month,
  navigate,
}: {
  kind: SuggestionKind;
  insights: InsightsData | null;
  month: string;
  navigate: NavigateFunction;
}) {
  if (!insights) return null;

  if (kind === "top-merchant") {
    const merchant = topMerchant(insights);
    if (!merchant) return null;
    return (
      <div className="assistant-suggestion">
        <p className="assistant-suggestion-line">
          {windowLabel(insights)}最常消費：<strong>{merchant.merchant}</strong>，共{" "}
          {formatMoneyMinor(merchant.total_minor)}（{merchant.count} 筆）
        </p>
        <button
          type="button"
          className="secondary-action"
          onClick={() => navigate("/reflect#merchants")}
        >
          看商家排行
        </button>
      </div>
    );
  }

  const projected = projectedMonthEndSpend(insights, month);
  return (
    <div className="assistant-suggestion">
      <p className="assistant-suggestion-line">
        {burnRateLabel(insights.burn_rate)}
        {projected !== null ? `，照這個速度月底約花 ${formatMoneyMinor(projected)}` : ""}
      </p>
      <button type="button" className="secondary-action" onClick={() => navigate("/reflect")}>
        看完整分析
      </button>
    </div>
  );
}

export function AssistantPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const txId = searchParams.get("tx");

  const month = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const insightsState = useInsights();

  const [msgs, setMsgs] = useState<AssistantMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [txContext, setTxContext] = useState<Transaction | null>(null);
  const [txLoadFailed, setTxLoadFailed] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!txId) return;
    let alive = true;
    api
      .getTransaction(txId)
      .then((tx) => {
        if (alive) setTxContext(tx);
      })
      .catch(() => {
        if (alive) setTxLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [txId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy]);

  const txLabel = txContext
    ? `${(txContext.merchant ?? txContext.description ?? "").trim() || "這筆交易"} ${formatMoneyMinor(txContext.amount)}`
    : null;

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const sentQuestion = txLabel ? `關於這筆交易（${txLabel}）：${trimmed}` : trimmed;
    setMsgs((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
    setBusy(true);
    api
      .aiAsk(sentQuestion, month)
      .then((r) => {
        if (r.ok && r.answer) {
          setMsgs((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "ai", text: r.answer!, suggestion: detectSuggestion(trimmed) },
          ]);
        } else {
          setMsgs((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "ai",
              text: r.error ? `後端回應錯誤：${r.error}` : "助理暫時回答不出來，換個問法試試",
            },
          ]);
        }
      })
      .catch((err: unknown) => {
        setMsgs((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "ai",
            text: `助理連線失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
          },
        ]);
      })
      .finally(() => setBusy(false));
  };

  const submitText = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    ask(text);
  };

  return (
    <div className="dashboard-content summary-stack">
      <header className="page-header">
        <p className="page-kicker">助理</p>
        <h1 className="page-title">問問這個月的錢都去哪了</h1>
        <p className="page-subtitle">用白話問預算、分類、異常，助理會附一張可執行的建議卡。</p>
      </header>

      {txLabel ? (
        <div className="assistant-context-banner">關於這筆：{txLabel}</div>
      ) : txLoadFailed ? (
        <div className="assistant-context-banner assistant-context-banner--error">
          找不到這筆交易，已改為一般提問。
        </div>
      ) : null}

      <section className="card assistant-card" aria-label="對話紀錄">
        <div className="assistant-thread" ref={listRef} aria-live="polite">
          {msgs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">
                <Sparkles size={22} strokeWidth={1.8} />
              </div>
              <h3 className="empty-state-title">先問一句看看</h3>
              <p className="empty-state-description">
                例如「這個月會超支嗎？」，助理會用這個月的實際數字回答，還可能附上可以點的建議卡。
              </p>
              <div className="empty-state-action">
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy}
                  onClick={() => ask(QUICK_CHIPS[0])}
                >
                  問看看：{QUICK_CHIPS[0]}
                </button>
              </div>
            </div>
          ) : (
            msgs.map((m) => (
              <div key={m.id} className={`assistant-msg assistant-msg--${m.role}`}>
                <div className="assistant-bubble">{renderInlineBold(m.text)}</div>
                {m.role === "ai" && m.suggestion ? (
                  <SuggestionCard
                    kind={m.suggestion}
                    insights={insightsState.data}
                    month={month}
                    navigate={navigate}
                  />
                ) : null}
              </div>
            ))
          )}
          {busy ? (
            <div className="assistant-msg assistant-msg--ai">
              <div className="assistant-bubble assistant-bubble--inline">
                <Loader2 size={14} className="assistant-spin" aria-hidden="true" /> 助理思考中…
              </div>
            </div>
          ) : null}
        </div>

        <div className="assistant-chip-row">
          {QUICK_CHIPS.map((q) => (
            <button
              key={q}
              type="button"
              className="chip-btn"
              disabled={busy}
              onClick={() => ask(q)}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="assistant-input-row">
          <textarea
            ref={textareaRef}
            className="assistant-input"
            placeholder="問點什麼，例如：這個月外食花多少？"
            rows={1}
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
          <button
            type="button"
            className="primary-action assistant-send"
            aria-label="送出"
            disabled={busy || !input.trim()}
            onClick={submitText}
          >
            <ArrowUpRight size={19} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
