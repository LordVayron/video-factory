// Phases and gates. A project can't spend on a phase until the phases before it are approved.
// Style, cast and sets are approved once in the bible and reused by every project that uses them.
import fs from "node:fs";
import path from "node:path";
import * as P from "./project.mjs";

export const PHASES = [
  { id: "concept", name: "Concept", what: "concept.md: logline, tone, references, length, platform, language" },
  { id: "style", name: "Style sheet", what: "bible/styles/<style>/style.json + approved north-star frame" },
  { id: "cast", name: "Cast", what: "an approved in-style character sheet (angle views) + voice for every character" },
  { id: "sets", name: "Sets", what: "an approved empty plate for every location" },
  { id: "storyboard", name: "Storyboard", what: "one cheap frame per shot + animatic, approved as a whole" },
  { id: "looktest", name: "Look test", what: "the style's winning models recorded (once per style)" },
  { id: "production", name: "Production", what: "final keyframes and clips, every shot passing QC" },
  { id: "post", name: "Post", what: "sound, music, finish, captions; final QC passed" },
  { id: "retro", name: "Retro", what: "lessons written back into the style sheet" },
];

// Phases each paid command needs approved first.
// The look test is no longer a gate: each style commits to its best model .
export const GATES = {
  storyboard: ["concept", "style", "cast", "sets"],
  frames: ["storyboard"],
  video: ["storyboard"],
};

function castOf(sl) {
  return [...new Set(sl.shots.flatMap((s) => s.characters || []))];
}
function setsOf(sl) {
  return [...new Set([sl.set, ...sl.shots.map((s) => s.set)].filter(Boolean))];
}

// Status of one phase: { ok, detail }
export function phaseStatus(sl, id) {
  const own = sl.phases?.[id];
  const approved = own?.status === "approved";
  switch (id) {
    case "style": {
      const st = P.style(sl.style);
      return { ok: st.status === "approved", detail: `${st.id}: ${st.status || "draft"}` };
    }
    case "cast": {
      if (!sl.shots.length) return { ok: approved, detail: "no shots yet" };
      const missing = castOf(sl).filter((id) => P.characterLook(P.character(id), sl.style).status !== "approved");
      return { ok: !missing.length, detail: missing.length ? `needs an approved ${sl.style} sheet: ${missing.join(", ")}` : `${castOf(sl).join(", ")} approved` };
    }
    case "sets": {
      const missing = setsOf(sl).filter((id) => P.set(id).status !== "approved");
      return { ok: !missing.length, detail: missing.length ? `not approved: ${missing.join(", ")}` : setsOf(sl).join(", ") || "none" };
    }
    case "looktest": {
      const st = P.style(sl.style);
      // Optional now: the style's committed model is used unless a look test is asked for.
      return { ok: true, detail: st.lookTest?.winner ? `committed: ${st.models?.video} @ ${st.models?.res}` : `committed: ${st.models?.video || "style default"}` };
    }
    case "production": {
      const items = sl.scenes?.length ? sl.scenes : sl.shots;
      const fails = items.filter((s) => s.clip == null || !s.clips?.[s.clip]?.qc?.pass).map((s) => s.id);
      return { ok: items.length > 0 && !fails.length, detail: !sl.shots.length ? "no shots yet" : fails.length ? `shots without a passing clip: ${fails.join(", ")}` : "all shots passed QC" };
    }
    case "post":
      return { ok: approved && sl.finalQc?.pass, detail: sl.finalQc ? (sl.finalQc.pass ? "final QC passed" : "final QC failed") : "not assembled" };
    default:
      return { ok: approved, detail: own?.status || "pending" };
  }
}

// Throw if a command's required phases aren't approved. Legacy projects (no "phases") skip gates.
export function requirePhases(sl, cmd, { force = false } = {}) {
  if (!sl.phases || force) return;
  const need = GATES[cmd] || [];
  const bad = need.map((id) => ({ id, ...phaseStatus(sl, id) })).filter((p) => !p.ok);
  if (bad.length) {
    throw new Error(`"${cmd}" is gated. Not approved yet:\n${bad.map((p) => `  - ${p.id}: ${p.detail}`).join("\n")}\nSee: node engine/phase.mjs status ${sl.slug}`);
  }
}

export function approveProjectPhase(slug, id, note = "") {
  return P.updateShotlist(slug, (sl) => {
    sl.phases ||= {};
    sl.phases[id] = { status: "approved", at: new Date().toISOString(), ...(note ? { note } : {}) };
  });
}

export const conceptPath = (slug) => path.join(P.PROJECTS, slug, "concept.md");
export const hasConcept = (slug) => fs.existsSync(conceptPath(slug));
