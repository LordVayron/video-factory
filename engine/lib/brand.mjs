// Brand memory: what the creator chose and rejected for one product or brand (music, voice, look), in their words,
// kept across every production of that brand. A new brief starts from the choices and never brings back a rejection;
// the engine prints them where the brief is checked, so they can't be skipped.
import fs from "node:fs";
import path from "node:path";
import * as P from "./project.mjs";

const DIR = path.join(P.BIBLE, "brands");
export const KINDS = ["music", "voice", "look"];

const slugify = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The brand of a project: its own field, or the product named in a launch brief.
export function brandOf(sl) {
  if (sl.brand) return slugify(sl.brand);
  const f = path.join(P.projectDir(sl.slug), "launch", "brief.json");
  try { return slugify(P.readJSON(f).product?.name) || null; } catch { return null; }
}

const file = (id) => path.join(DIR, `${id}.json`);
export function load(id) {
  if (!id || !fs.existsSync(file(id))) return { id, ...Object.fromEntries(KINDS.map((k) => [k, { picked: [], rejected: [] }])) };
  return P.readJSON(file(id));
}

export function note(id, kind, verdict, desc, { said, project }) {
  if (!KINDS.includes(kind)) throw new Error(`kind is one of ${KINDS.join(", ")}`);
  if (!["picked", "rejected"].includes(verdict)) throw new Error("verdict is picked or rejected");
  const b = load(id);
  b[kind] ||= { picked: [], rejected: [] };
  b[kind][verdict].push({ desc, said, project, at: new Date().toISOString() });
  fs.mkdirSync(DIR, { recursive: true });
  P.writeJSON(file(id), b);
  return b;
}

// The lines a brief must answer for one kind: what was chosen, what was rejected.
export function history(sl, kind) {
  const b = load(brandOf(sl))[kind] || { picked: [], rejected: [] };
  return {
    picked: b.picked.map((x) => `${x.desc} (chosen: "${x.said}")`),
    rejected: b.rejected.map((x) => `${x.desc} (rejected: "${x.said}")`),
  };
}
