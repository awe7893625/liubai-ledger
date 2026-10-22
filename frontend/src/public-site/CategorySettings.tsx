import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

type Category = { id: string; name: string; slug: string };
type Props = { session: Session; categories: Category[]; onChanged: () => Promise<void> };
export function CategorySettings({ session, categories, onChanged }: Props) {
  const [selected, setSelected] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = async () => {
    if (lock.current || !name.trim()) return;
    lock.current = true; setBusy(true); setNotice(""); setFailed(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch("/api/v2/categories", {
        method: selected ? "PATCH" : "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), ...(selected ? { id: selected.id, expected_name: selected.name } : {}) }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.category?.id) throw new Error(data.error || "尚未確認儲存結果，請重新載入");
      if (!alive.current) return;
      setSelected(null); setName(""); setNotice("分類已儲存；原交易與預算的分類連結保持不變。");
      await onChanged().catch(() => { if (alive.current) setNotice("分類已儲存，列表更新失敗。請重新整理，不必再新增。"); });
    } catch (error) {
      if (alive.current) { setFailed(true); setNotice(controller.signal.aborted ? "連線逾時，請重新整理確認結果後再試。" : error instanceof Error ? error.message : "儲存失敗"); }
    } finally { window.clearTimeout(timer); lock.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="lf-settings-card" aria-label="分類管理">
    <header><div><h2>分類管理</h2><p>新增自己的分類；修改名稱會套用到既有交易。</p></div><small>{categories.length} / 100</small></header>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>{selected ? `修改「${selected.name}」` : "新增分類"}<input aria-label="分類名稱" maxLength={32} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：寵物、旅行、訂閱" required disabled={busy} /></label>
      <div className="lf-inline-actions"><button className="ls-button ls-primary" disabled={busy || !name.trim()}>{busy ? "儲存中…" : selected ? "儲存分類名稱" : "新增分類"}</button>{selected ? <button type="button" className="ls-button ls-secondary" disabled={busy} onClick={() => { setSelected(null); setName(""); }}>取消改名</button> : null}</div>
    </form>
    <div className="lf-category-list">{categories.map((category) => <button type="button" key={category.id} disabled={busy} aria-label={`修改分類 ${category.name}`} onClick={() => { setSelected(category); setName(category.name); setNotice(""); }}><span>{category.name}</span><small>改名</small></button>)}</div>
    <p className="lf-helper">目前保留分類以維持歷史交易與預算連結，暫不提供直接刪除。</p>
    {notice ? <p role={failed ? "alert" : "status"}>{notice}</p> : null}
  </section>;
}
