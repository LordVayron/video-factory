// Production locks that hold for every format.
//
// ENGINE FREEZE: a production finishes on the engine it started with. Changing the engine mid-production turned
// each fix into new bugs and full redraws, so once a project has started, any paid job refuses to run when the engine
// code changed, until the creator agrees to continue on the new engine (studio.mjs engine-update <slug> --said).
// CANCELLED: a cancelled project spends nothing more.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Code only: price lists and measured data change without changing how the engine behaves.
const CODE = /\.(mjs|js|py)$/;
const SKIP = new Set(["data", "board", "node_modules"]);

export function engineSha(root = ENGINE) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(d, e.name)); continue; }
      if (CODE.test(e.name)) files.push(path.join(d, e.name));
    }
  };
  walk(root);
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(path.relative(root, f).replace(/\\/g, "/")).update("\0").update(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
  return h.digest("hex").slice(0, 12);
}

// Returns the reason a paid job must not run, or null. `stamp` records the engine on a project that has none yet.
export function freezeProblem(sl, { current = engineSha(), stamp = () => {} } = {}) {
  if (sl.cancelled) return `CANCELLED: ${sl.slug || "this project"} was cancelled (${sl.cancelled.said ? `"${sl.cancelled.said}"` : "by the creator"}); it spends nothing more.`;
  const delivered = (sl.flow?.log || []).filter((e) => e.event === "deliver").at(-1)?.at;
  if (delivered && !(sl.remake?.at > delivered)) return null;
  if (!sl.engine?.sha) { stamp(current); return null; }
  if (sl.engine.sha === current) return null;
  return `ENGINE FREEZE: the engine changed since this production started on it (${sl.engine.sha} → ${current}). A production finishes on its own engine: deliver first, change the engine after. To continue on the new engine, show the creator what changed and record their yes (studio.mjs engine-update ${sl.slug} --said "...").`;
}
