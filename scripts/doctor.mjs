#!/usr/bin/env node
// Checks that this machine can run the factory: tools, Python packages, keys, assets.
//   npm run doctor            (add --online to also ping Kie and ElevenLabs with your keys)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, env } from "../engine/lib/env.mjs";

const online = process.argv.includes("--online");
let failed = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg, fix) => { failed++; console.log(`  FAIL  ${msg}${fix ? `\n        fix: ${fix}` : ""}`); };
const warn = (msg) => console.log(`  warn  ${msg}`);
const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", shell: false });

console.log("\nTools");
const major = Number(process.versions.node.split(".")[0]);
major >= 22 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node} (need 22+, built on 24)`, "install Node 24 LTS");
for (const t of ["ffmpeg", "ffprobe"]) {
  const r = run(t, ["-version"]);
  r.status === 0 ? ok(r.stdout.split("\n")[0].slice(0, 60)) : bad(`${t} not on PATH`, "winget install Gyan.FFmpeg");
}
const py = run("python", ["--version"]);
py.status === 0 ? ok(py.stdout.trim() || py.stderr.trim()) : bad("python not on PATH", "install Python 3.12");

console.log("\nPython packages");
for (const [mod, pkg] of [["numpy", "numpy"], ["faster_whisper", "faster-whisper"], ["PIL", "Pillow"], ["pypdf", "pypdf"]]) {
  run("python", ["-c", `import ${mod}`]).status === 0 ? ok(pkg) : bad(pkg, "pip install -r requirements.txt");
}

console.log("\nNode packages");
fs.existsSync(path.join(ROOT, "node_modules", "@anthropic-ai", "sdk")) ? ok("node_modules installed") : bad("node_modules missing", "npm ci");

console.log("\nKeys (values are never printed)");
const kie = env("KIE_API_TOKEN") || env("KIE_AI_API_KEY");
const el = env("ELEVENLABS_API_KEY");
kie ? ok("KIE_API_TOKEN set") : bad("KIE_API_TOKEN missing", "copy .env.example to .env and paste your key (https://kie.ai/api-key)");
el ? ok("ELEVENLABS_API_KEY set") : bad("ELEVENLABS_API_KEY missing", "copy .env.example to .env and paste your key (https://elevenlabs.io/app/settings/api-keys)");

console.log("\nRepository");
for (const p of ["engine/gen.mjs", "engine/longform.mjs", "bible/styles", "templates/studio.json", ".claude/skills/studio/SKILL.md", ".claude/skills/onboarding/SKILL.md"]) {
  fs.existsSync(path.join(ROOT, p)) ? ok(p) : bad(`${p} missing`, "clone the full repo");
}
fs.existsSync(path.join(ROOT, "studio.json")) ? ok("studio.json (creator profile)") : warn("no studio.json yet: the onboarding skill creates it");

if (online) {
  console.log("\nAccounts");
  if (kie) {
    const { credits } = await import("../engine/lib/kie.mjs");
    try { const c = await credits(); ok(`Kie: ${c} credits ($${(c * 0.005).toFixed(2)})`); } catch (e) { bad(`Kie: ${e.message.slice(0, 80)}`); }
  }
  if (el) {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": el } });
    if (r.ok) { const s = await r.json(); ok(`ElevenLabs: ${s.tier}, ${s.character_count}/${s.character_limit} characters used`); }
    else {
      // Scoped keys without "user_read" can still do TTS; confirm the key with a voices call instead.
      const v = await fetch("https://api.elevenlabs.io/v1/voices?page_size=1", { headers: { "xi-api-key": el } });
      v.ok ? warn("ElevenLabs: key works, but it lacks the user_read permission, so the plan and quota can't be shown") : bad(`ElevenLabs: HTTP ${v.status}`, "check ELEVENLABS_API_KEY");
    }
  }
}

console.log(failed ? `\n${failed} problem(s). Fix them, then run npm run doctor again.\n` : "\nAll good. Open your agent in this folder and say what you want to make.\n");
process.exit(failed ? 1 : 0);
