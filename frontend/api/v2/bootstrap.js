import {
  adminClient,
  handleError,
  requireUser,
  send,
} from "../_shared/cloud.js";

const DEFAULT_CATEGORIES = [
  ["餐飲", "food"],
  ["交通", "transport"],
  ["購物", "shopping"],
  ["居家", "home"],
  ["娛樂", "entertainment"],
  ["醫療", "health"],
  ["教育", "education"],
  ["其他", "other"],
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const user = await requireUser(req);
    const db = adminClient();

    const { error: profileError } = await db
      .from("ledger_profiles")
      .upsert({
        user_id: user.id,
        locale: "zh-TW",
        timezone: "Asia/Taipei",
        plan: "free",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    const { error: accountError } = await db
      .from("ledger_accounts")
      .upsert([
        {
          user_id: user.id,
          name: "未指定卡片",
          type: "card",
          currency: "TWD",
        },
        {
          user_id: user.id,
          name: "現金",
          type: "cash",
          currency: "TWD",
        },
      ], { onConflict: "user_id,name", ignoreDuplicates: true });
    if (accountError) throw accountError;

    const { error: categoryError } = await db
      .from("ledger_categories")
      .upsert(DEFAULT_CATEGORIES.map(([name, slug]) => ({
        user_id: user.id,
        name,
        slug,
      })), { onConflict: "user_id,slug", ignoreDuplicates: true });
    if (categoryError) throw categoryError;

    const [{ data: profile, error: profileReadError },
      { data: accounts, error: accountsError },
      { data: categories, error: categoriesError }] = await Promise.all([
      db.from("ledger_profiles")
        .select("user_id,locale,timezone,plan,created_at,updated_at")
        .eq("user_id", user.id)
        .single(),
      db.from("ledger_accounts")
        .select("id,name,type,issuer,currency,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      db.from("ledger_categories")
        .select("id,name,slug")
        .eq("user_id", user.id)
        .order("name", { ascending: true }),
    ]);
    if (profileReadError) throw profileReadError;
    if (accountsError) throw accountsError;
    if (categoriesError) throw categoriesError;

    return send(res, 200, {
      ok: true,
      profile,
      accounts: accounts || [],
      categories: categories || [],
    });
  } catch (error) {
    return handleError(res, error);
  }
}
