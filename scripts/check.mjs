#!/usr/bin/env node
// Offline smoke checks: every engine file parses, every JSON in the repo parses, and the
// fixed regressions stay fixed. No network, no spend.
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { ROOT } from "../engine/lib/env.mjs";
import { isNoise } from "../engine/lib/noise.mjs";

let failed = 0;
const t = (name, cond) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}`); if (!cond) failed++; };
// Media folders of projects and series hold renders, not code or JSON: skipping them keeps the check fast.
const MEDIA_DIRS = new Set(["clips", "frames", "audio", "out", "book", "episodes", "renders", "vo"]);
const walk = (d, out = []) => {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git", ".cache"].includes(f) || MEDIA_DIRS.has(f)) continue;
    const x = path.join(d, f);
    fs.statSync(x).isDirectory() ? walk(x, out) : out.push(x);
  }
  return out;
};

const files = walk(ROOT);
// Every module parses: node --check, 8 at a time.
{
  const mods = files.filter((x) => x.endsWith(".mjs")), res = new Map(), q = [...mods];
  const check = (f) => new Promise((r) => spawn(process.execPath, ["--check", f]).on("close", (code) => r(code === 0)));
  await Promise.all(Array.from({ length: 8 }, async () => { while (q.length) { const f = q.shift(); res.set(f, await check(f)); } }));
  for (const f of mods) t(`parses ${path.relative(ROOT, f)}`, res.get(f));
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
t("budget guard counts jobs of other processes under one mutex (parallel gen.mjs runs cannot pass the cap together)", gen.includes("othersInFlight(slug)") && gen.includes("budgetMutex(slug)") && gen.includes("writeClaim(slug, credits)"));
t("recover gives old locks one short look, drops tasks dead for hours and skips jobs of live processes", gen.includes("timeoutMs: age > 30 * 60e3 ? 20e3") && gen.includes("age < 3 * 36e5") && gen.includes("j.pid !== process.pid && alive(j.pid)"));
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
(await import("./check-direction.mjs")).default(t, ROOT);
(await import("./check-refs.mjs")).default(t, ROOT);
await (await import("./check-providers.mjs")).default(t, ROOT);
(await import("./check-camera.mjs")).default(t, ROOT);

// What goes into a repo says what changed, never the owner's instructions: no quotes of the owner in
// code comments or logs, and the guard refuses commit messages, tags and release notes that carry them.
{
  const { unquote } = await import("./unquote.mjs");
  const srcs = ["engine", "engine/lib", "scripts", "scripts/hooks"].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(mjs|py)$/.test(f) && !["publish-public.mjs", "unquote.mjs"].includes(f)).map((f) => path.join(d, f)));
  const logs = ["docs/improvements-log.md", "HANDOFF.md", "CHANGELOG.md"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const quoted = [...srcs, ...logs].filter((f) => { const s = fs.readFileSync(path.join(ROOT, f), "utf8"); return unquote(s) !== s; });
  t(`no quotes of the owner's instructions in code comments or logs (${quoted.join(", ") || "none"})`, !quoted.length);
  // Comments say why a rule exists, not when or on which production it was learned (that lives in git and the changelog).
  // Production names come from the private publish script (its PRIVATE list), so they never appear in this file; a
  // public install only checks dates.
  const pubScript = path.join(ROOT, "scripts", "publish-public.mjs");
  const names = fs.existsSync(pubScript) ? /const PRIVATE = \/(.+)\/i;/.exec(fs.readFileSync(pubScript, "utf8"))?.[1] : null;
  const STORY = new RegExp(String.raw`\b20\d\d-\d\d-\d\d\b` + (names ? `|${names}` : ""), "i");
  const storied = srcs.filter((f) => !f.endsWith("check.mjs")).flatMap((f) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").map((l, i) => [f, i + 1, l]))
    .filter(([f, , l]) => { const k = l.indexOf(f.endsWith(".py") ? "# " : "// "); return k > -1 && STORY.test(l.slice(k)); }).map(([f, i]) => `${f}:${i}`);
  t(`code comments explain why, without dates or production stories (${storied.slice(0, 5).join(", ") || "none"})`, !storied.length);
  // The engine speaks English (the agent reads its messages and talks to the creator in their language). Spanish text
  // stays only where it is data: the claim detector for Spanish scripts and the quote detector.
  const DATA_ES = /const CLAIMY = |const WHO = |\/\/ data: the creator's words/;
  const spanish = srcs.filter((f) => f.endsWith(".mjs") && !f.endsWith("check.mjs")).flatMap((f) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").map((l, i) => [f, i + 1, l]))
    .filter(([, , l]) => !/^\s*\/\//.test(l) && !DATA_ES.test(l) && /[áéíóúñ¿¡]/.test(l.replace(/\/\/.*$/, ""))).map(([f, i]) => `${f}:${i}`);
  t(`engine messages are in English (${spanish.slice(0, 5).join(", ") || "none"})`, !spanish.length);
  const { decide } = await import("./hooks/guard.mjs");
  const commit = (m) => !!decide({ tool_name: "Bash", tool_input: { command: `git commit -m "${m}"` } }, { branchOf: () => "feat" });
  const { FACTORY } = await import("./hooks/guard.mjs");
  if (FACTORY.length) {
    const on = (b, c) => !!decide({ tool_name: "Bash", tool_input: { command: c } }, { branchOf: () => b });
    t("main changes only through a PR: the guard refuses a commit or push straight to main and allows branches and tags", on("main", 'git commit -m "x"') && on("feat", "git push origin main") && on("main", "git push") && !on("feat", 'git commit -m "feat: x"') && !on("feat", "git push -u origin feat") && !on("main", "git push origin v1.2.3"));
    const pub = fs.readFileSync(path.join(ROOT, "scripts", "publish-public.mjs"), "utf8");
    t("publishing goes through a PR in the public repo (branch, PR with the file list, squash-merge after approval)", pub.includes('gh("pr", "create"') && pub.includes('"--squash", "--delete-branch"') && pub.includes("carriesInstructions(`${prTitle}"));
  }
  const { subjectProblems } = await import("./unquote.mjs");
  t("commit subjects and PR titles follow Conventional Commits (type: summary, short)", !subjectProblems("ci: run the offline checks on every PR").length && subjectProblems("Add CI").length && subjectProblems(`feat: ${"x".repeat(80)}`).length && subjectProblems("feat(guard): x", { max: 64 }).length === 0);
  if (FACTORY.length) t("the guard refuses a commit subject without a type in the factory's repos", !!decide({ tool_name: "Bash", tool_input: { command: 'git commit -m "Add CI"' } }, { branchOf: () => "feat" }) && !decide({ tool_name: "Bash", tool_input: { command: 'git commit -m "ci: add CI"' } }, { branchOf: () => "feat" }));
  t("the offline checks run on GitHub for every PR (workflow + npm test)", fs.existsSync(path.join(ROOT, ".github", "workflows", "check.yml")) && /npm test/.test(fs.readFileSync(path.join(ROOT, ".github", "workflows", "check.yml"), "utf8")) && !!JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts?.test);
  t("the guard refuses a commit message that names or quotes the owner and lets a plain one through", commit("Providers (asked by the creator)") && commit('Providers: \\"put the main provider first please\\"') && !commit("feat: APIMart is the main provider"));
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
// The guard lets a commit through only when the checks passed on exactly this code (engine/ and scripts/).
if (!failed) {
  const { codeSha } = await import("./hooks/stamp.mjs");
  fs.mkdirSync(path.join(ROOT, ".cache"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, ".cache", "check-pass.json"), JSON.stringify({ sha: codeSha(), at: new Date().toISOString() }));
}
process.exit(failed ? 1 : 0);
