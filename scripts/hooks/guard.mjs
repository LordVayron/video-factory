#!/usr/bin/env node
// Claude Code PreToolUse guard (flow v5). Two rules that hold even when the agent forgets them:
//  1. No paid API call outside the engine. A script, an inline `node -e`/`python -c`, or a curl that reaches
//     APIMart, Kie, ElevenLabs or the vision judge without going through engine/ (budget lock, flow gates, ledger) is denied.
//     Why: a shot once ran through a one-off runner script, so no gate and no eval ever saw it.
//  2. No video or audio is sent to the creator without a delivery receipt (studio.mjs deliver) whose hash matches the
//     file. Files named *DRAFT* or *PREVIEW* can be sent to ask him something; they are never deliverables.
// Configured in .claude/settings.json. Reads the tool call as JSON on stdin; prints a deny decision or nothing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { carriesInstructions } from "../unquote.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// APIMart (2026-10-22, the main provider) counts like Kie; its public price list (/api/pricing) is free to read.
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

export function decide({ tool_name: tool, tool_input: input = {} }, { branchOf = branchIn } = {}) {
  // Rule 1: commands.
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const raw = String(input.command || "");
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
    // Rule 4: no commit or push straight to main in the factory's repos; work on a branch and open a PR (2026-10-22).
    for (const seg of raw.split(/&&|\|\||;|\n/).reduce((acc, p) => { const cd = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(p); acc.dir = cd ? path.resolve(acc.dir, cd[1].replace(/^["']|["']$/g, "")) : acc.dir; acc.out.push({ p, dir: acc.dir }); return acc; }, { dir: input.cwd || ROOT, out: [] }).out) {
      const m = /\bgit\s+(?:-C\s+("[^"]+"|'[^']+'|\S+)\s+)?(commit|push)\b(.*)/.exec(seg.p);
      if (!m) continue;
      const dir = m[1] ? path.resolve(seg.dir, m[1].replace(/^["']|["']$/g, "")) : seg.dir;
      const repo = FACTORY.find((r) => { const x = path.relative(r, dir); return !x.startsWith("..") && !path.isAbsolute(x); });
      if (!repo) continue;
      const onMain = branchOf(repo) === "main";
      const toMain = m[2] === "push" && (/(^|\s|:)main\b/.test(m[3]) || (onMain && !/\s(-u\s+)?origin\s+\S/.test(m[3]) && !/\bv\d+\.\d+\.\d+\b|--tags/.test(m[3])));
      if ((m[2] === "commit" && onMain) || toMain) return deny(`no ${m[2]} straight to main in ${path.basename(repo)}: work on a branch and open a PR (routine step 0). Merging is done with gh pr merge after the owner approves.`);
    }
    // Rule 3: commit messages, tags and release notes say what changed, never the owner's instructions (2026-10-22).
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
    const d = decide(call);
    if (d) process.stdout.write(JSON.stringify(d));
    process.exit(0);
  });
}
