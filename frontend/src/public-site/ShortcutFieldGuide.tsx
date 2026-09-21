import {
  Check,
  ChevronDown,
  Code2,
  LockKeyhole,
  MessageSquare,
  Type,
} from "lucide-react";

export function ShortcutFieldGuide() {
  return (
    <section
      className="ls-field-guide"
      id="shortcut-fields"
      aria-labelledby="shortcut-fields-title"
    >
      <div className="ls-field-heading">
        <span className="ls-eyebrow">
          OPEN THE EDITOR · ONLY CHANGE TWO VALUES
        </span>
        <h3 id="shortcut-fields-title">哪裡要改？哪些不能刪？</h3>
        <p>
          <strong>註解是給人看的；「文字」是捷徑要用的設定。</strong>
          安裝後看到一大段文字不是錯誤，也不需要把它全部刪掉。
        </p>
      </div>
      <div className="ls-field-grid">
        <article className="ls-field-card ls-field-comment">
          <header>
            <MessageSquare size={18} />
            <b>註解／說明</b>
            <span>可以保留</span>
          </header>
          <div className="ls-field-preview">
            Ledger｜留白工作室
            <br />
            這一塊是安裝說明。
            <br />
            下面兩個「文字」才是設定。
          </div>
          <p>
            只供閱讀，不會作為交易資料送出。設定完成不必刪；真的要整理，只刪「註解」動作，不要連下面的文字一起刪。
          </p>
        </article>
        <article className="ls-field-card">
          <header>
            <Type size={18} />
            <b>第一個「文字」</b>
            <span>改內容，不刪動作</span>
          </header>
          <div className="ls-field-preview">
            <small>LEDGER_URL · 網址設定</small>
            <code>https://ledger.example.invalid/api/wallet</code>
            <span className="ls-field-arrow">↓ 整段換成</span>
            <code>https://你的主機/api/wallet</code>
          </div>
          <p>
            必須是手機連得到的<strong>自己的 HTTPS 網址</strong>
            。不填工作室官網，不填 localhost，也不加「LEDGER_URL=」。
          </p>
        </article>
        <article className="ls-field-card">
          <header>
            <LockKeyhole size={18} />
            <b>第二個「文字」</b>
            <span>改內容，不刪動作</span>
          </header>
          <div className="ls-field-preview">
            <small>LEDGER_TOKEN · 驗證設定</small>
            <code>REPLACE_WITH_YOUR_INGEST_TOKEN</code>
            <span className="ls-field-arrow">↓ 整段換成</span>
            <code>你自己產生的 Token 值</code>
          </div>
          <p>
            使用自己主機 .env 的 LEDGER_INGEST_TOKEN：
            <strong>只貼等號右邊的值</strong>
            ，不含引號、變數名稱。不要貼給工作室或公開分享。
          </p>
        </article>
      </div>
      <div className="ls-field-runtime">
        <Code2 size={20} />
        <div>
          <h4>下面的 amount／merchant／card 與「取得 URL 內容」都要保留</h4>
          <p>
            「在捷徑輸入中取得 merchant 的數值」裡的「數值」是
            <strong>辭典 Value（對應的值）</strong>，不是把商家轉為數字。amount
            為金額；merchant、card
            為文字。藍色變數可能都叫「文字」，請點開查看它連到哪個動作，不要只靠顯示名稱猜。
          </p>
        </div>
      </div>
      <details className="ls-field-request" open>
        <summary>
          展開「取得 URL 內容」旁的藍色箭頭，核對這四項{" "}
          <ChevronDown size={17} />
        </summary>
        <div className="ls-field-request-grid">
          <div>
            <b>URL</b>
            <p>連到第一個「文字」的網址，不是第二個 Token。</p>
          </div>
          <div>
            <b>方法：POST</b>
            <p>不是預設的 GET。</p>
          </div>
          <div>
            <b>標頭：X-Ledger-Token</b>
            <p>值連到第二個「文字」的 Token。</p>
          </div>
          <div>
            <b>要求內文：JSON</b>
            <p>amount、merchant、card 各連到前面取得的辭典值。</p>
          </div>
        </div>
      </details>
      <div className="ls-field-checklist" aria-label="安裝到記帳驗收順序">
        <h4>安裝完成 ≠ 已自動記帳</h4>
        <ol>
          <li>
            先部署自己的 Ledger，手機 Safari 開自己的 /api/health，確認 status:
            ok。
          </li>
          <li>
            安裝 Manual 和 Wallet，兩份捷徑的 URL 與 Token
            都要設定。新版可用「自訂捷徑」輸入問題；沒有跳出時就編輯上面兩格。
          </li>
          <li>
            先執行 Manual，輸入 1 元和「連線測試」。只有看到 ok:true、tx_id
            且自己的流水出現同一筆，才算連通；看到通知不等於成功。
          </li>
          <li>
            再到 iPhone 交易自動化，把 amount／merchant／card 字典當作 Ledger
            Wallet 的輸入，選立即執行。
          </li>
          <li>
            自行完成一次感應付款，再核對金額、商家、卡片。不要直接按 Wallet 的 ▶
            做空輸入測試。
          </li>
        </ol>
      </div>
      <p className="ls-field-update">
        <Check size={15} />
        已安裝舊版不會隨網站自動更新。尚未填設定時可重新下載；已設定完成先保留原捷徑，確認新版設定及自動化指向後再替換，避免兩個自動化重複記帳。
      </p>
      <p className="ls-field-sources">
        設定介面示意，非實機截圖。參考：
        <a
          href="https://support.apple.com/zh-tw/guide/shortcuts/apdf01294032/ios"
          target="_blank"
          rel="noreferrer"
        >
          Apple：取得辭典值
        </a>{" "}
        ·{" "}
        <a
          href="https://support.apple.com/zh-tw/guide/shortcuts/apd58d46713f/ios"
          target="_blank"
          rel="noreferrer"
        >
          要求 API
        </a>{" "}
        ·{" "}
        <a
          href="https://support.apple.com/zh-tw/guide/shortcuts/apdf330fd3a0/ios"
          target="_blank"
          rel="noreferrer"
        >
          輸入問題
        </a>
      </p>
    </section>
  );
}
