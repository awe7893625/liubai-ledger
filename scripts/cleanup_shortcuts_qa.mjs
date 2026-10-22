// Server-only cleanup for e2e_shortcuts_v2.py. No browser headers or credentials.
// Input contains only this run's exact synthetic user IDs and usernames.
import { readFileSync } from "node:fs";
import { adminClient } from "../frontend/api/_shared/cloud.js";

async function main() {
  if (new URL(process.env.SUPABASE_URL).hostname !== "vhosvmnhdrzkhmkmptqg.supabase.co") throw new Error("Project mismatch");
  const manifest = JSON.parse(readFileSync(0, "utf8"));
  if (!/^[a-f0-9]{10}$/.test(manifest.run_id) || !Array.isArray(manifest.users) || manifest.users.length > 2) throw new Error("Invalid QA scope");
  const db = adminClient();
  const results = [];
  for (const entry of manifest.users) {
    if (!["qa_a_", "qa_b_", "qa_launch_a_", "qa_launch_b_"].map((prefix) => prefix + manifest.run_id).includes(entry.username)) throw new Error("Not this run's synthetic username");
    const lookup = await db.auth.admin.getUserById(entry.id);
    if (lookup.error && lookup.error.status !== 404) throw new Error("QA lookup failed");
    if (lookup.data?.user) {
      const user = lookup.data.user;
      if (user.user_metadata?.username !== entry.username || user.user_metadata?.provider === "google" || !user.email?.endsWith("@users.liubai.invalid")) throw new Error("Refuse non-synthetic user");
      const deleted = await db.auth.admin.deleteUser(entry.id);
      if (deleted.error) throw new Error("QA deletion failed");
    }
    const verify = await db.auth.admin.getUserById(entry.id);
    if (verify.data?.user || verify.error?.status !== 404) throw new Error("QA auth cleanup not verified");
    for (const table of ["ledger_profiles", "ledger_accounts", "ledger_categories", "ledger_transactions", "ledger_devices", "ledger_wallet_events"]) {
      const count = await db.from(table).select("user_id", { count: "exact", head: true }).eq("user_id", entry.id);
      if (count.error || count.count !== 0) throw new Error("QA rows remain");
    }
    results.push({ synthetic_user_removed: true, scoped_remaining_rows: 0 });
  }
  process.stdout.write(JSON.stringify({ ok: true, cleanup: results }));
}
main().catch((error) => {
  console.error("Synthetic QA cleanup failed:", error.message);
  process.exitCode = 1;
});
