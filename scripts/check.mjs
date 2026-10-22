#!/usr/bin/env node
// Offline smoke checks: every engine file parses, every JSON in the repo parses, and the
// regressions fixed in the 2026-10-17 audit stay fixed. No network, no spend.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "../engine/lib/env.mjs";
import { isNoise } from "../engine/lib/noise.mjs";

let failed = 0;
const t = (name, cond) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}`); if (!cond) failed++; };
const walk = (d, out = []) => {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git", ".cache"].includes(f)) continue;
    const x = path.join(d, f);
    fs.statSync(x).isDirectory() ? walk(x, out) : out.push(x);
  }
  return out;
};

const files = walk(ROOT);
for (const f of files.filter((x) => x.endsWith(".mjs"))) {
  t(`parses ${path.relative(ROOT, f)}`, spawnSync(process.execPath, ["--check", f]).status === 0);
}
const badJson = files.filter((x) => x.endsWith(".json")).filter((x) => { try { JSON.parse(fs.readFileSync(x, "utf8")); return false; } catch { return true; } });
t(`all JSON parses (${badJson.map((x) => path.relative(ROOT, x)).join(", ") || "none bad"})`, !badJson.length);

const edit = fs.readFileSync(path.join(ROOT, "engine", "edit.mjs"), "utf8");
t("edit.mjs loudness regex keeps its digits", edit.includes("mean_volume: (-?[\\d.]+)"));
t("edit.mjs onset regex keeps its classes", edit.includes("silence_start: 0[\\s\\S]*?silence_end: ([\\d.]+)"));
t("vocal noise is not dialogue", ["MAH", "Ooooo", "hmmm", "Mwahaha", "woooof"].every(isNoise));
t("real words are dialogue", !["stick", "foot", "scary", "rent"].some(isNoise));
const gen = fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8");
t("budget guard counts jobs in flight", gen.includes("inFlight.get(slug)"));
const kie = fs.readFileSync(path.join(ROOT, "engine", "lib", "kie.mjs"), "utf8");
t("kie.run never resubmits after a timeout", kie.includes("/timed out/i.test(e.message) ||"));

// Real token shapes only (prefix plus a long body), so this file does not flag itself.
const lf = fs.readFileSync(path.join(ROOT, "engine", "longform.mjs"), "utf8");
t("long-form loops start from the still only (same first and last frame froze the motion); the build hides the seam", !fs.readFileSync(path.join(ROOT, "engine", "gen.mjs"), "utf8").includes("frame: url, lastFrame: url") && fs.readFileSync(path.join(ROOT, "engine", "longform.mjs"), "utf8").includes("cross-fade to hide its seam"));
t("long-form joins pieces by stream copy", lf.includes('"-f", "concat", "-safe", "0", "-i", pieceList, "-c", "copy"'));

const secret = /(gh[opsu]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{30,}|sk_[a-f0-9]{40,}|KIE_API_TOKEN=\s*[A-Za-z0-9]{16,}|ELEVENLABS_API_KEY=\s*[A-Za-z0-9_]{16,})/;
const leaks = files.filter((x) => /\.(mjs|js|json|md|py|txt|ps1|sh)$/.test(x) && secret.test(fs.readFileSync(x, "utf8")));
t(`no secrets in text files (${leaks.map((x) => path.relative(ROOT, x)).join(", ") || "clean"})`, !leaks.length);

(await import("./check-flow.mjs")).default(t, ROOT);
(await import("./check-launch.mjs")).default(t, ROOT);

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
