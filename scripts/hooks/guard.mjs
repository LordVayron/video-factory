#!/usr/bin/env node
// Claude Code PreToolUse guard (flow v5). Two rules that hold even when the agent forgets them:
//  1. No paid API call outside the engine. A script, an inline `node -e`/`python -c`, or a curl that reaches
//     APIMart, Kie, ElevenLabs or the vision judge without going through engine/ (budget lock, flow gates, ledger) is denied.
//     Why: a one-off runner script skips every gate and eval.
//  2. No video or audio is sent to the creator without a delivery receipt (studio.mjs deliver) whose hash matches the
//     file. Files named *DRAFT* or *PREVIEW* can be sent to ask him something; they are never deliverables.
// Configured in .claude/settings.json. Reads the tool call as JSON on stdin; prints a deny decision or nothing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { carriesInstructions, subjectProblems } from "../unquote.mjs";
import { creatorMessages, isQuestion, norm, APPROVAL } from "./creator.mjs";
import { checkedProblem } from "./stamp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// APIMart (the main provider) counts like Kie; its public price list (/api/pricing) is free to read.
const API = /api\.kie\.ai|api\.apimart\.ai\/(?!api\/pricing)|elevenlabs\.io|lib[\\/](kie|apimart|providers|eleven|judge|identity)\.mjs|\b(kie|apimart|eleven)\.(upload|createTask|waitTask|run|sts|tts|sfx)\(|\bPV\.(run|submit|submitBest)\(|\bidentityCheck\(|\bjudge(JSON)?\(/;
const CODE = /\.(mjs|cjs|js|ts|py|ps1|sh|bat|cmd)$/i;
// Python and shell can't import the engine's modules, so for them only a direct call to the API hosts counts
// (a doc-writing script that merely names lib/identity.mjs is fine).
const HOSTS = /api\.kie\.ai|api\.apimart\.ai\/(?!api\/pricing)|elevenlabs\.io/;
const reaches = (file, text) => (/\.(mjs|cjs|js|ts)$/i.test(file) ? API : HOSTS).test(text);
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac)$/i;
const inside = (f, d) => { const r = path.relative(path.join(ROOT, d), path.resolve(ROOT, f)); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
const allowedCode = (f) => inside(f, "engine") || inside(f, "scripts");

// The factory's two repos: main changes only through a reviewed PR (the public one is also protected on GitHub; the
// private one can't be on the free plan, so this rule is its protection).
// Only in the owner's private checkout (the one with the publish script); a public install works as it likes.
export const FACTORY = fs.existsSync(path.join(ROOT, "scripts", "publish-public.mjs")) ? [ROOT, path.resolve(ROOT, "..", "ai-video-factory-public")] : [];
const branchIn = (dir) => spawnSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout?.trim();

// The subject (first line) of a commit: from -m, from -F <file> (or the printf/heredoc that writes it in the same
// command), or null when it can't be told (an editor would open; the agent never does that).
function subjectOf(args, raw, dir) {
  const first = (t) => String(t).replace(/\\n/g, "\n").split("\n")[0].trim();
  const m = /(?:^|\s)(?:-m|--message)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(args);
  if (m) return first(m[2] ?? m[3]);
  const f = /(?:^|\s)(?:-F|--file)\s+("[^"]+"|'[^']+'|\S+)/.exec(args);
  if (!f) return null;
  const name = f[1].replace(/^["']|["']$/g, "");
  if (name === "-") { const h = /<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1\b/.exec(raw); return h ? first(h[2]) : null; }
  const w = new RegExp(String.raw`(?:printf|echo)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')\s*>\s*["']?[^\s"']*${path.basename(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(raw);
  if (w) return first(w[2] ?? w[3]);
  const abs = path.isAbsolute(name) ? name : path.resolve(dir, name.replace(/^\$\{?TEMP\}?/, process.env.TEMP || ""));
  return fs.existsSync(abs) ? first(fs.readFileSync(abs, "utf8")) : null;
}

// Engine commands that spend (provider jobs, the vision judge, ElevenLabs). Free subcommands are listed apart.
const SPEND = /\b(gen|launch|cut|edit|longform|continuity|cast|series|refs|qc)\.mjs\s+("[^"]*"|\S+)/g;
const FREE = { gen: /^(credits|prices|models|estimate|recover)$/, launch: /^(check|apply|animatic|review|build|package|waive-test|voice-accept|style-from-refs)$/, cut: /^$/, edit: /^$/, longform: /^(estimate|build|script|image)$/, continuity: /^$/, cast: /^(approve|list|show)$/, series: /^(new|show)$/, refs: /^(add|breakdown|page|approve|list)$/, qc: /^$/ };
const spends = (raw) => [...raw.matchAll(SPEND)].some((m) => !FREE[m[1]].test(m[2].replace(/^["']|["']$/g, "")));
// Commands whose --said spends more or retries past a stop: the creator's words must say yes.
const YES_NEEDED = /\b(gen\.mjs\s+\S+|phase\.mjs\s+budget|studio\.mjs\s+(override|accept-take|engine-update|approve-replan|waive-compare)|launch\.mjs\s+(voice-accept|waive-test))\b/;

export function decide({ tool_name: tool, tool_input: input = {}, transcript_path }, { branchOf = branchIn, messages = creatorMessages(transcript_path), checkStamp = false } = {}) {
  // Rule 1: commands.
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const raw = String(input.command || "");
    // What runs: heredoc bodies are data (file contents, test fixtures), and quoted text is an argument.
    const run = raw.replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\1\b/g, "");
    const bare = run.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    // Rule 6: no shell loop around a paid engine command. A loop of single jobs skipped the engine's batch order
    // (a shot drawn from a stale previous frame) and its cost and time preview; batches have their own commands.
    if (spends(run) && (/\b(for|while|until)\b[\s\S]*?\bdo\b|\bForEach-Object\b|\bforeach\s*\(|%\s*\{/.test(bare)))
      return deny("no shell loop around paid engine commands. Use the engine's batch command (gen.mjs frame-chain, gen.mjs scenes, gen.mjs storyboard...), which keeps the order, shows the cost and time first and stops on the first failure.");
    if (messages?.length) {
      const last = messages.at(-1).text;
      // Rule 7: a question gets an answer, not a paid job.
      if (spends(run) && isQuestion(last)) return deny(`the creator's last message is a question ("${last.slice(0, 120)}"). Answer it; spend nothing until they say to.`);
      // Rule 8: --said carries the creator's literal words, from a message they wrote.
      for (const m of run.matchAll(/--said\s+("((?:[^"\\]|\\.)*)"|'([^']*)'|\S+)/g)) {
        const said = m[2] ?? m[3] ?? m[1];
        if (/^\$|\$\{?\w/.test(said)) return deny("--said must be the creator's words written literally, not a variable.");
        const n = norm(said);
        const from = messages.find((x) => norm(x.text).includes(n));
        if (!from) return deny(`--said "${said.slice(0, 80)}" is not in any message the creator wrote. Quote their exact words, or ask them.`);
        if (YES_NEEDED.test(run) && (!APPROVAL.test(n) || isQuestion(from.text))) return deny(`--said "${said.slice(0, 80)}" doesn't say yes to spending or retrying. Ask the creator for a clear yes.`);
      }
    }
    // Parts of the command that only read files (grep lib/kie.mjs, sed -n, cat...) can't call anything: drop them
    // before looking for inline code, so a read next to an unrelated `node -e` is not mistaken for an API call.
    const READ = /^\s*(cd|grep|rg|sed\s+-n|cat|head|tail|less|ls|wc|diff|git\s+(log|diff|show|status)|echo|printf|find)\b/;
    const cmd = raw.split(/(&&|\|\||;|\||\n)/).filter((p) => !READ.test(p)).join(" ");
    // Inline code or a raw HTTP call that reaches a paid API.
    if (API.test(cmd) && /(node|python3?|py)\s+(-e|-c|--eval|--input-type|-)\b|<<|curl|wget|Invoke-(WebRequest|RestMethod)|fetch\(/i.test(cmd))
      return deny("Paid API call outside the engine. Use the engine commands (gen.mjs, cut.mjs, continuity.mjs, studio.mjs): they carry the budget lock, the flow gates and the ledger.");
    // A script file outside engine/ or scripts/ that reaches a paid API.
    for (const m of cmd.matchAll(/(?:node|python3?|py|bash|sh|pwsh|powershell)(?:\s+-\S+)*\s+("[^"]+"|'[^']+'|\S+)/gi)) {
      const f = m[1].replace(/^["']|["']$/g, "");
      if (!CODE.test(f)) continue;
      const abs = path.isAbsolute(f) ? f : path.resolve(input.cwd || ROOT, f);
      if (allowedCode(abs) || !fs.existsSync(abs)) continue;
      if (reaches(abs, fs.readFileSync(abs, "utf8"))) return deny(`${f} calls a paid API outside the engine. One-off runner scripts are not allowed (a real failure); add the step to the engine instead.`);
    }
    // Rule 4: no commit or push straight to main in the factory's repos; work on a branch and open a PR.
    for (const seg of raw.split(/&&|\|\||;|\n/).reduce((acc, p) => { const cd = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(p); acc.dir = cd ? path.resolve(acc.dir, cd[1].replace(/^["']|["']$/g, "")) : acc.dir; acc.out.push({ p, dir: acc.dir }); return acc; }, { dir: input.cwd || ROOT, out: [] }).out) {
      const m = /\bgit\s+(?:-C\s+("[^"]+"|'[^']+'|\S+)\s+)?(commit|push)\b(.*)/.exec(seg.p);
      if (!m) continue;
      const dir = m[1] ? path.resolve(seg.dir, m[1].replace(/^["']|["']$/g, "")) : seg.dir;
      const repo = FACTORY.find((r) => { const x = path.relative(r, dir); return !x.startsWith("..") && !path.isAbsolute(x); });
      if (!repo) continue;
      const onMain = branchOf(repo) === "main";
      const toMain = m[2] === "push" && (/(^|\s|:)main\b/.test(m[3]) || (onMain && !/\s(-u\s+)?origin\s+\S/.test(m[3]) && !/\bv\d+\.\d+\.\d+\b|--tags/.test(m[3])));
      // Rule 9: a commit in the factory's private repo only after npm run check passed on this exact code.
      if (m[2] === "commit" && checkStamp && repo === ROOT) { const why = checkedProblem(ROOT); if (why) return deny(why); }
      if ((m[2] === "commit" && onMain) || toMain) return deny(`no ${m[2]} straight to main in ${path.basename(repo)}: work on a branch and open a PR (routine step 0). Merging is done with gh pr merge after the owner approves.`);
      // Rule 5: commit subjects follow Conventional Commits (type: summary, under 72 characters).
      if (m[2] === "commit") {
        const sub = subjectOf(m[3], raw, dir);
        const bad = sub == null ? [] : subjectProblems(sub);
        if (bad.length) return deny(`commit subject "${sub}": ${bad.join("; ")}.`);
      }
    }
    // Rule 5 for PR titles in the factory's repos (the squash merge turns the title into the commit subject).
    const prT = /\bgh\s+pr\s+(?:create|edit)\b.*?(?:--title|-t)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(raw);
    if (prT && FACTORY.length && (/ai-video-factory|video-factory/.test(raw) || FACTORY.some((r) => path.resolve(input.cwd || ROOT).startsWith(r)))) {
      const bad = subjectProblems(prT[2] ?? prT[3], { max: 64 });
      if (bad.length) return deny(`PR title "${prT[2] ?? prT[3]}": ${bad.join("; ")}.`);
    }
    // Rule 3: commit messages, tags and release notes say what changed, never the owner's instructions.
    if (/\bgit\s+(commit|tag)\b|\bgh\s+(release|pr)\s+(create|edit)\b/.test(raw)) {
      const texts = [...raw.matchAll(/(?:-m|--message|--notes|--title|--body|-b|-t|printf|echo)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/g)].map((m) => m[2] ?? m[3]);
      for (const h of raw.matchAll(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\1\b/g)) texts.push(h[2]);
      for (const m of raw.matchAll(/(?:-F|--file|--notes-file|--body-file)\s+("[^"]+"|'[^']+'|\S+)/g)) {
        const f = m[1].replace(/^["']|["']$/g, "").replace(/^\$\{?TEMP\}?/, process.env.TEMP || "");
        const abs = path.isAbsolute(f) ? f : path.resolve(input.cwd || ROOT, f);
        if (fs.existsSync(abs)) texts.push(fs.readFileSync(abs, "utf8"));
      }
      for (const t of texts) {
        const why = carriesInstructions(t);
        if (why.length) return deny(`a commit message, tag or release note carries the owner's instructions (${why.join("; ")}). Say only what changed.`);
      }
    }
  }
  // Rule 1: files that would become such scripts.
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const f = String(input.file_path || input.notebook_path || "");
    const text = String(input.content ?? input.new_string ?? input.new_source ?? (input.edits || []).map((e) => e.new_string).join("\n"));
    if (CODE.test(f) && !allowedCode(f) && reaches(f, text)) return deny(`${f} would call a paid API outside engine/ or scripts/. Put the logic in the engine, behind its gates.`);
  }
  // Rule 2: sending media to the creator.
  if (tool === "SendUserFile") {
    for (const f of input.files || []) {
      if (!MEDIA.test(f) || /draft|preview/i.test(path.basename(f))) continue;
      const abs = path.isAbsolute(f) ? f : path.resolve(ROOT, f);
      const m = /[\\/]projects[\\/]([^\\/]+)[\\/]/.exec(abs);
      const receipt = m && path.join(ROOT, "projects", m[1], "delivery.json");
      if (!receipt || !fs.existsSync(receipt)) return deny(`${path.basename(f)} has no delivery receipt. Run studio.mjs qc and studio.mjs deliver first, or name it *PREVIEW* if it is only to ask the creator something.`);
      const r = JSON.parse(fs.readFileSync(receipt, "utf8"));
      const sha = crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
      const mp3 = abs.replace(/\.mp3$/i, ".mp4");
      const okFile = sha === r.sha || (abs !== mp3 && fs.existsSync(mp3) && crypto.createHash("sha1").update(fs.readFileSync(mp3)).digest("hex") === r.sha);
      if (!okFile) return deny(`${path.basename(f)} is not the file that passed the final QC (the receipt's hash does not match). Re-run studio.mjs qc and deliver.`);
    }
  }
  return null;
}

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Flow v5 guard: ${reason}` } });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let call;
    try { call = JSON.parse(raw); } catch { process.exit(0); }
    const d = decide(call, { checkStamp: true });
    if (d) process.stdout.write(JSON.stringify(d));
    process.exit(0);
  });
}
