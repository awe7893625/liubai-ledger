// Authorized test-fixture setup only. Creates exactly two synthetic users, no emails.
// Not a public-signup test and does not modify signup/login rate limits.
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { adminClient, internalAuthEmail } from "../frontend/api/_shared/cloud.js";

async function main() {
  if (new URL(process.env.SUPABASE_URL).hostname !== "vhosvmnhdrzkhmkmptqg.supabase.co") throw new Error("Project mismatch");
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (!/^[a-f0-9]{10}$/.test(input.run_id) || !input.manifest.endsWith("cleanup-manifest.json")) throw new Error("Invalid fixture scope");
  const db = adminClient(); const users = [];
  for (const label of ["a", "b"]) {
    const username = `qa_${label}_${input.run_id}`;
    const password = "QA!" + randomBytes(24).toString("base64url");
    const result = await db.auth.admin.createUser({ email: internalAuthEmail(username), password, email_confirm: true, user_metadata: { username, qa_fixture: true } });
    if (result.error || !result.data?.user) throw new Error("Fixture creation failed; inspect exact-ID manifest");
    users.push({ id: result.data.user.id, username, password });
    writeFileSync(input.manifest, JSON.stringify({ run_id: input.run_id, users: users.map(({ id, username: name }) => ({ id, username: name })) }), { mode: 0o600 });
    chmodSync(input.manifest, 0o600);
    const profile = await db.from("ledger_profiles").insert({ user_id: result.data.user.id, username_norm: username, username_display: username, locale: "zh-TW", timezone: "Asia/Taipei", plan: "free" });
    if (profile.error) throw new Error("Fixture profile creation failed; inspect exact-ID manifest");
  }
  // Parent captures stdout in memory; do not redirect this to a public test report.
  process.stdout.write(JSON.stringify({ users }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
