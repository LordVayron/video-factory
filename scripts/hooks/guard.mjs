#!/usr/bin/env node
// Claude Code PreToolUse guard (flow v5). Two rules that hold even when the agent forgets them:
//  1. No paid API call outside the engine. A script, an inline `node -e`/`python -c`, or a curl that reaches
//     Kie, ElevenLabs or the vision judge without going through engine/ (budget lock, flow gates, ledger) is denied.
//     Why: a shot once ran through a one-off runner script, so no gate and no eval ever saw it.
//  2. No video or audio is sent to the creator without a delivery receipt (studio.mjs deliver) whose hash matches the
//     file. Files named *DRAFT* or *PREVIEW* can be sent to ask him something; they are never deliverables.
// Configured in .claude/settings.json. Reads the tool call as JSON on stdin; prints a deny decision or nothing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const API = /api\.kie\.ai|elevenlabs\.io|lib[\\/](kie|eleven|judge|identity)\.mjs|\b(kie|eleven)\.(upload|createTask|waitTask|run|sts|tts|sfx)\(|\bidentityCheck\(|\bjudge(JSON)?\(/;
const CODE = /\.(mjs|cjs|js|ts|py|ps1|sh|bat|cmd)$/i;
// Python and shell can't import the engine's modules, so for them only a direct call to the API hosts counts
// (a doc-writing script that merely names lib/identity.mjs is fine).
const HOSTS = /api\.kie\.ai|elevenlabs\.io/;
const reaches = (file, text) => (/\.(mjs|cjs|js|ts)$/i.test(file) ? API : HOSTS).test(text);
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|mp3|wav|m4a|aac|flac)$/i;
const inside = (f, d) => { const r = path.relative(path.join(ROOT, d), path.resolve(ROOT, f)); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
const allowedCode = (f) => inside(f, "engine") || inside(f, "scripts");

export function decide({ tool_name: tool, tool_input: input = {} }) {
  // Rule 1: commands.
  if (/^(Bash|PowerShell)$/.test(tool)) {
    const cmd = String(input.command || "");
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
