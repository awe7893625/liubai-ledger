// Public, non-secret build identity. Never reads dotenv files or credentials.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let revision = "unknown";
let modified = null;
try {
  revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const changes = execFileSync("git", ["status", "--porcelain", "--untracked-files=no", "--", "src", "api", "scripts", "package.json", "package-lock.json", "vercel.json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  modified = Boolean(changes.trim());
} catch {
  if (/^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA || "")) revision = process.env.VERCEL_GIT_COMMIT_SHA;
}
if (/^[a-f0-9]{40}$/i.test(process.env.LEDGER_BUILD_REVISION || "")) revision = process.env.LEDGER_BUILD_REVISION;
if (!/^[a-f0-9]{40}$/i.test(revision)) revision = "unknown";
const data = { product: "liubai-ledger", schema_version: 1, source_revision: revision,
  source_modified: modified, built_at: new Date().toISOString() };
mkdirSync(resolve(root, "public"), { recursive: true });
writeFileSync(resolve(root, "public", "version.json"), JSON.stringify(data) + "\n");
console.log(`Release metadata: ${revision.slice(0, 12)}${modified ? " (local changes)" : ""}`);
