import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, ChevronRight, Download, Play, RefreshCw, Smartphone, WalletCards } from "lucide-react";
import "./shortcut-onboarding.css";

type Device = { id: string; name: string; created_at: string; revoked_at: string | null };
type Receipt = { received_at: string; transaction_id: string | null; needs_review: boolean };
type Progress = { device_id: string; stage: "manual_required" | "wallet_setup_ready" | "wallet_received_review" | "wallet_receipt_received";
  manual_receipt: Receipt | null; wallet_receipt: Receipt | null; can_configure_wallet: boolean; ios_trigger_attested: false };
type Response = { ok: boolean; devices: Device[]; onboarding: { devices: Progress[]; checked_at: string } };
type Props = { session: Session; compact?: boolean; pairingBusy: boolean; onPair: () => Promise<void>; onOpenSettings: () => void };

function runManual() {
  const query = new URLSearchParams({ name: "留白手動記帳", "x-success": `${window.location.origin}/connect?tab=settings&setup=apple-pay`,
    "x-cancel": `${window.location.origin}/connect?tab=settings` });
  return `shortcuts://x-callback-url/run-shortcut?${query.toString()}`;
}

function labelTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function ShortcutOnboarding({ session, compact = false, pairingBusy, onPair, onOpenSettings }: Props) {
  const [result, setResult] = useState<Response | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [watching, setWatching] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const owner = useRef(session.user.id);
  const active = (result?.devices ?? []).filter((d) => !d.revoked_at);
  const selected = active.find((d) => d.id === selectedId) ?? active[0];
  const progress = result?.onboarding?.devices.find((d) => d.device_id === selected?.id);
  const manualPassed = Boolean(progress?.manual_receipt);
  const walletReceived = Boolean(progress?.wallet_receipt);
  const fresh = Boolean(result && !error);

  const refresh = useCallback(async () => {
    if (controller.current && !controller.current.signal.aborted) return;
    const requestOwner = session.user.id;
    const seq = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 20000);
    setChecking(true);
    try {
      const response = await fetch("/api/v2/devices?onboarding=1", { signal: abort.signal,
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("暫時無法確認入帳進度，請重試。");
      const data = await response.json() as Response;
      if (!data.ok || !data.onboarding || !Array.isArray(data.onboarding.devices)) throw new Error("尚未取得入帳驗證狀態。");
      if (seq !== generation.current || owner.current !== requestOwner) return;
      setResult(data); setError("");
      setSelectedId((current) => data.devices.some((d) => d.id === current && !d.revoked_at)
        ? current : data.devices.find((d) => !d.revoked_at)?.id || "");
    } catch (issue) {
      if (seq === generation.current && owner.current === requestOwner) {
        setError(issue instanceof Error && issue.name !== "AbortError" ? issue.message : "確認逾時，請重試；不會視為測試成功。");
      }
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
      if (seq === generation.current) setChecking(false);
    }
  }, [session.access_token, session.user.id]);

  const cancelPending = useCallback(() => { ++generation.current; controller.current?.abort(); controller.current = null; }, []);

  useEffect(() => {
    owner.current = session.user.id;
    setResult(null); setSelectedId(""); setError(""); setWatching(false);
    void refresh();
    const resume = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", resume); window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { cancelPending(); window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume); document.removeEventListener("visibilitychange", resume); };
  }, [session.user.id, refresh, cancelPending]);

  useEffect(() => {
    if (!watching || compact) return;
    // Foreground, time-bounded polling only. Returning from Shortcuts also refreshes.
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000);
    const timeout = window.setTimeout(() => setWatching(false), 90000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [watching, compact, refresh]);
  useEffect(() => { if (manualPassed) setWatching(false); }, [manualPassed]);

  const heading = !fresh ? "先用捷徑記一筆，再開啟 Apple Pay 自動記帳"
    : !selected ? "先完成手動捷徑測試"
      : !manualPassed ? "iPhone 已配對，現在用手動捷徑記一筆"
        : !walletReceived ? "手動捷徑成功，下一步設定 Apple Pay"
          : progress?.wallet_receipt?.needs_review ? "已收到 Wallet 資料，還有欄位待確認" : "已收到 Apple Pay 記帳資料";

  if (compact) return <section className="ls-shortcut-banner" aria-label="Apple Pay 自動記帳入門">
    <span className="ls-shortcut-banner-icon"><WalletCards size={22} /></span>
    <div><p>留白的自動記帳</p><h2>{heading}</h2><small>手動捷徑驗證 → 設定交易自動化 → 感應付款入帳</small></div>
    <button type="button" className="ls-button ls-primary" onClick={onOpenSettings}>{manualPassed ? "繼續設定" : "開始設定"}<ChevronRight size={16} /></button>
  </section>;

  return <section className="ls-shortcut-setup" aria-label="捷徑與 Apple Pay 設定流程">
    <header><div><p>Apple Pay 自動記帳</p><h2>{heading}</h2><span>先確認這支 iPhone 能把交易存進自己的帳本，再接上付款觸發。</span></div>
      <button type="button" className="ls-button ls-secondary" onClick={() => void refresh()} disabled={checking}><RefreshCw size={15} />{checking ? "確認中…" : "更新測試結果"}</button></header>
    {error ? <p className="ls-shortcut-error" role="alert">{error} 舊進度僅供參考，請更新後繼續。</p> : null}
    {active.length > 0 ? <label className="ls-shortcut-device">正在設定的裝置<select aria-label="正在設定的裝置" value={selected?.id || ""} onChange={(e) => { setSelectedId(e.target.value); setWatching(false); }}>
      {active.map((d) => <option key={d.id} value={d.id}>{d.name} · {labelTime(d.created_at)}</option>)}
    </select><small>每支裝置分開驗證，不會拿別支手機的成功紀錄替代。</small></label> : null}

    <article className="ls-shortcut-step" data-complete={Boolean(selected)}>
      <span className="ls-shortcut-number">{selected ? <CheckCircle2 size={19} /> : "1"}</span>
      <div><h3>安裝手動捷徑，連接自己的帳本</h3><p>先安裝新版「留白手動記帳」，再按連接。舊版請選取代並保留名稱；不需要填 API、JSON 或密鑰。</p>
        <div className="ls-shortcut-actions"><a className="ls-button ls-secondary" href="/shortcuts/Liubai-Manual.shortcut" download><Download size={16} />安裝手動記帳</a>
          <button className="ls-button ls-primary" type="button" disabled={pairingBusy} onClick={() => { setSelectedId(""); setWatching(true); void onPair(); }}><Smartphone size={16} />{selected ? "重新配對這支 iPhone" : "連接 iPhone"}</button></div>
        <small>重新配對會建立新的裝置憑證，需要重新測試；舊裝置可在下方解除。</small></div>
    </article>

    <article className="ls-shortcut-step" data-complete={manualPassed}>
      <span className="ls-shortcut-number">{manualPassed ? <CheckCircle2 size={19} /> : "2"}</span>
      <div><h3>用手動捷徑成功記一筆</h3>
        {manualPassed ? <p className="ls-shortcut-pass" role="status">手動捷徑入帳已確認 · {labelTime(progress!.manual_receipt!.received_at)}</p>
          : <p>打開捷徑選「記支出」，輸入金額、用途與自己的付款方式，確認後送出。看到記帳成功通知，再回這頁確認。</p>}
        <div className="ls-shortcut-actions">{selected && fresh ? <a className="ls-button ls-primary" href={runManual()} onClick={() => setWatching(true)}><Play size={16} />開啟手動捷徑</a> : <button className="ls-button ls-secondary" type="button" disabled>先安裝並配對</button>}
          <button type="button" className="ls-button ls-secondary" onClick={() => { setWatching(true); void refresh(); }} disabled={checking || !selected}>我已送出，檢查結果</button></div>
        <p className="ls-shortcut-hint">建議記一筆真實的小額支出。也可用「捷徑測試」記 1 元，但這會新增交易；驗證後可刪除，成功紀錄仍保留。單純「測試連線」或在網站記帳不算此步完成。</p>
        {watching ? <small role="status">正在檢查入帳結果；回到此頁也會更新。</small> : null}
      </div>
    </article>

    <article className="ls-shortcut-step" data-complete={walletReceived && !progress?.wallet_receipt?.needs_review}>
      <span className="ls-shortcut-number">3</span>
      <div><h3>接上 Apple Pay 交易自動化</h3>
        {!manualPassed || !fresh ? <><p>手動捷徑成功入帳後，這裡會開放 Apple Pay 的設定教學。</p><button className="ls-button ls-secondary" type="button" disabled>完成上一個步驟後繼續</button></>
          : <><p className="ls-shortcut-pass">記帳管道已測通，可以設定這支 iPhone 的交易自動化。</p>
            <div className="ls-shortcut-actions"><a className="ls-button ls-primary" href="/shortcuts/Liubai-Cloud.shortcut" download><Download size={16} />安裝自動記帳</a></div>
            <details className="ls-shortcut-guide" open><summary>Apple Pay 設定教學</summary>
              <ol><li>在「捷徑」新增「交易」個人自動化，選自己的 Wallet 卡片；支援多張卡的介面可選全部。商家、類別先不限制。</li>
                <li>設定「立即執行」或關閉「執行前詢問」。新版若把觸發器放在捷徑裡，另建一支「Apple Pay 入口」，從它的「編輯 → 自動化 → 交易」加入；需要時在隱私設定允許鎖定時執行。</li>
                <li>在自動化（或新版的「Apple Pay 入口」）先加入「辭典」，再加入「執行捷徑」，選「留白自動記帳」，輸入選剛才的辭典。不要讓捷徑呼叫自己，也不要只按自動捷徑的播放鍵測試。</li></ol>
              <table><thead><tr><th>辭典欄位</th><th>使用交易變數</th></tr></thead><tbody><tr><td><code>amount</code></td><td>金額（你的介面可能顯示「數量」）</td></tr><tr><td><code>merchant</code></td><td>商家</td></tr><tr><td><code>card</code></td><td>卡片名稱／卡片或票卡，轉成文字</td></tr></tbody></table>
              <p>這不是要手動輸入金額或銀行名稱，而是插入當次交易的變數。每個使用者用自己的卡，並在下方「付款方式」設定 Wallet 別名。</p>
              <a href="https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios" target="_blank" rel="noreferrer">Apple 官方交易觸發說明</a>
            </details>
            {walletReceived ? <p className={progress?.wallet_receipt?.needs_review ? "ls-shortcut-error" : "ls-shortcut-pass"} role="status">{progress?.wallet_receipt?.needs_review ? "已收到 Wallet 記帳資料，請檢查金額、商家或卡片對應。" : "後端已收到 Wallet 交易資料並確認入帳。"}</p>
              : <p className="ls-shortcut-hint">待首次感應付款驗證：下次正常消費時，用這支 iPhone 在實體刷卡機感應，再回來確認。網站不能代替手機設定，也不能驗證 iOS 是否真的觸發。</p>}
          </>}
      </div>
    </article>
    <footer>手動成功代表記帳連線與權限正常，不等於已開啟 Apple Pay 自動化。網站／App 內付款不保證觸發；沒有自動入帳時可用手動捷徑補記。</footer>
  </section>;
}
