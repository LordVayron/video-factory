// Dialogue check: every scripted line is heard, nothing extra, no stutters. Runs align.py (faster-whisper).
// Used on every take of a clips project and on every final cut (studio.mjs qc).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./env.mjs";
import { isNoise } from "./noise.mjs";

export const isVocal = (l) => l.vocal || /^(mwa|ha|awoo|woof|meow|grr|hm+|ah+|oh+)[-a-z! ]*$/i.test(String(l.text || "").trim());

// lines: [{ id, text }]. A file with no scripted lines passes when nothing much is said either.
// pronounce: a brand name read in another language ({ word, said }, set in the creator's words); the transcriber spells
// it differently, so it is left out of the word match (the voice step already matched it).
export function dialogueCheck(file, lines, lang = "en", pronounce = null) {
  if (pronounce?.said && pronounce.word) { const re = new RegExp(`\\b${pronounce.word}\\b`, "gi"); lines = lines.map((l) => ({ ...l, text: String(l.text).replace(re, "").replace(/\s+/g, " ").trim() })); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlg-"));
  const L = path.join(tmp, "lines.json"), A = path.join(tmp, "align.json");
  fs.writeFileSync(L, JSON.stringify(lines));
  const r = spawnSync("python", [path.join(ROOT, "engine", "lib", "align.py"), file, L, A, lang === "es" ? "es" : "en"], { encoding: "utf8" });
  if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); return { pass: false, issues: [`dialogue check could not run: ${(r.stderr || "").slice(-200)}`] }; }
  const al = JSON.parse(fs.readFileSync(A, "utf8"));
  fs.rmSync(tmp, { recursive: true, force: true });
  const issues = [];
  for (const l of al.lines || []) if (l.found < 0.8) issues.push(`line ${l.id} missing or garbled (${Math.round(l.found * 100)}% heard)`);
  const extras = (al.extras || []).filter((w) => w.replace(/[^a-z]/gi, "").length > 1 && !isNoise(w));
  if (extras.length > 2) issues.push(`${extras.length} words not in the script: ${extras.slice(0, 8).join(" ")}`);
  for (const w of (al.repeats || []).filter((x) => !isNoise(x))) issues.push(`repeated word "${w}"`);
  return { pass: !issues.length, issues, lines: (al.lines || []).map((l) => ({ id: l.id, start: l.start, end: l.end, found: l.found })) };
}
