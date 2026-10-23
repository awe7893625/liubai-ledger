import { useEffect, useRef, useState } from "react";

type Version = { source_revision: string; built_at: string; source_modified: boolean | null };
export function ServiceStatus() {
  const [version, setVersion] = useState<Version | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<"unchecked" | "healthy" | "unavailable">("unchecked");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; inFlight.current?.abort(); };
  }, []);

  const check = async () => {
    if (inFlight.current) return;
    const controller = new AbortController(); inFlight.current = controller;
    setChecking(true); setNotice("");
    const timer = window.setTimeout(() => controller.abort(), 12000);
    try {
      const responses = await Promise.all([
        fetch("/api/v2/health", { cache: "no-store", signal: controller.signal }),
        fetch("/version.json", { cache: "no-store", signal: controller.signal }),
      ]);
      const [health, release] = await Promise.all(responses.map((response) => response.json()));
      if (!responses[0].ok || health?.ok !== true || !responses[1].ok || release?.product !== "liubai-ledger") throw new Error("網站連線或版本資訊尚未確認。");
      if (typeof release.source_revision !== "string" || !/^(?:[a-f0-9]{40}|unknown)$/.test(release.source_revision) || !Number.isFinite(Date.parse(release.built_at))) throw new Error("版本資訊格式無法確認。");
      if (!alive.current) return;
      setVersion({ source_revision: release.source_revision, built_at: release.built_at, source_modified: release.source_modified === null ? null : Boolean(release.source_modified) });
      setStatus("healthy"); setCheckedAt(new Date().toISOString());
      setNotice("網站連線正常。這只驗證服務可達，不代表私人帳本或 Apple Pay 已同步。");
    } catch {
      if (alive.current) { setStatus("unavailable"); setCheckedAt(new Date().toISOString()); setNotice("未完成連線檢查。請確認網路；這不表示帳本資料已遺失。"); }
    } finally { window.clearTimeout(timer); inFlight.current = null; if (alive.current) setChecking(false); }
  };

  const copy = async () => {
    const report = {
      product: "Liubai Ledger", revision: version?.source_revision || "not-checked", built_at: version?.built_at || null,
      service_check: status, checked_at: checkedAt, page: window.location.pathname,
      excludes: "No account identifiers, IP, tokens, transaction details or financial totals.",
    };
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setNotice("已複製不含個資與交易明細的診斷資訊，可貼給支援。 "); }
    catch { setNotice("無法使用剪貼簿。可將上方版本與檢查結果提供給支援。 "); }
  };

  return <section className="ls-service-status" aria-label="服務狀態與版本">
    <h3>服務狀態與版本</h3>
    <p>只檢查網站連線，不讀取或新增交易。回報問題不必附上完整帳本截圖。</p>
    <dl><dt>連線檢查</dt><dd>{checking ? "檢查中…" : status === "healthy" ? "正常" : status === "unavailable" ? "尚未確認" : "尚未檢查"}</dd>
      <dt>網站版本</dt><dd>{version?.source_revision === "unknown" ? "來源未標記" : version?.source_revision.slice(0, 12) || "—"}</dd>
      <dt>最後檢查</dt><dd>{checkedAt ? new Date(checkedAt).toLocaleString("zh-TW") : "—"}</dd></dl>
    <div className="ls-service-actions"><button className="ls-button ls-secondary" type="button" disabled={checking} onClick={() => void check()}>檢查連線（不記帳）</button><button className="ls-button ls-secondary" type="button" disabled={checking || status === "unchecked"} onClick={() => void copy()}>複製診斷資訊</button></div>
    {notice ? <p role={status === "unavailable" ? "alert" : "status"}>{notice}</p> : null}
  </section>;
}
