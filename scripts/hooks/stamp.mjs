// The fingerprint of the code the checks ran on (engine/ and scripts/). `npm run check` writes it to
// .cache/check-pass.json when every check passes; the guard refuses a commit in the factory repo whose code doesn't
// match it, so untested code (a typo in a regex, a broken escape) never reaches a commit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engineSha } from "../../engine/lib/freeze.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const codeSha = (root = ROOT) => `${engineSha(path.join(root, "engine"))}-${engineSha(path.join(root, "scripts"))}`;

export function checkedProblem(root = ROOT) {
  const f = path.join(root, ".cache", "check-pass.json");
  if (!fs.existsSync(f)) return "npm run check has not passed on this code; run it before committing.";
  let stamp = null;
  try { stamp = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  return stamp?.sha === codeSha(root) ? null : "the code changed since npm run check last passed; run it again before committing.";
}
