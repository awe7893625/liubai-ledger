import { adminClient, bodyOf, handleError, httpError, requireUser, send, sha256Hex } from "./cloud.js";

export function categoryName(value) {
  if (typeof value !== "string") throw httpError(400, "請填寫分類名稱");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || [...name].length > 32 || /[\u0000-\u001f\u007f]/.test(value)) throw httpError(400, "分類名稱需為 1–32 字，不能含控制字元");
  return name;
}
const key = (name) => name.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
const slug = (name) => "custom_" + sha256Hex(key(name)).slice(0, 32);

// No schema changes. Rename keeps the category ID, existing transactions and
// monthly budget references. Deletion is deliberately unavailable until every
// dependent planning/budget reference can be migrated atomically.
export default async function categoryHandler(req, res) {
  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, PATCH");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    const user = await requireUser(req);
    const db = adminClient();
    const { data, error } = await db.from("ledger_categories").select("id,name,slug").eq("user_id", user.id).order("name");
    if (error) throw error;
    const categories = data || [];
    if (req.method === "GET") return send(res, 200, { ok: true, categories });
    const body = bodyOf(req);
    const name = categoryName(body.name);
    const id = req.method === "PATCH" && typeof body.id === "string" ? body.id.trim() : "";
    if (categories.some((row) => row.id !== id && key(row.name) === key(name))) throw httpError(409, "已有相同名稱的分類");
    if (req.method === "POST") {
      if (categories.length >= 100) throw httpError(400, "分類已達 100 個上限");
      const result = await db.from("ledger_categories").insert({ user_id: user.id, name, slug: slug(name) }).select("id,name,slug").maybeSingle();
      if (result.error?.code === "23505") throw httpError(409, "分類已存在，請重新整理確認");
      if (result.error) throw result.error;
      if (!result.data) throw httpError(503, "尚未確認分類已建立，請重新整理");
      return send(res, 201, { ok: true, category: result.data });
    }
    const current = categories.find((row) => row.id === id);
    if (!current) throw httpError(404, "找不到這個分類");
    if (body.expected_name !== current.name) throw httpError(409, "分類已被其他裝置修改，請重新整理後再儲存");
    if (name === current.name) return send(res, 200, { ok: true, category: current });
    const changes = { name, ...(current.slug.startsWith("custom_") ? { slug: slug(name) } : {}) };
    const result = await db.from("ledger_categories").update(changes).eq("user_id", user.id).eq("id", id).eq("name", current.name).select("id,name,slug").maybeSingle();
    if (result.error?.code === "23505") throw httpError(409, "已有相同名稱的分類");
    if (result.error) throw result.error;
    if (!result.data) throw httpError(409, "分類已被其他裝置修改，請重新整理");
    return send(res, 200, { ok: true, category: result.data });
  } catch (error) { return handleError(res, error); }
}
