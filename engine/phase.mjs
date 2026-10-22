#!/usr/bin/env node
// Project phases and gates.
//
//   node engine/phase.mjs new <slug> --style <id> --title "..." [--format sitcom] [--lang en] [--ar 9:16] [--set <setId>]
//   node engine/phase.mjs status <slug>
//   node engine/phase.mjs approve <slug> concept|storyboard|post|retro [--note "..."]
//
// Style, cast, sets and look test are approved in the bible (style.mjs / cast.mjs) and reused across projects.
import fs from "node:fs";
import path from "node:path";
import * as P from "./lib/project.mjs";
import { PHASES, phaseStatus, approveProjectPhase, conceptPath } from "./lib/phases.mjs";

const argv = process.argv.slice(2);
const [cmd, slug, which] = argv;
const flag = (n, d = null) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };

const CONCEPT = `# Concept: {title}

- **Format:** {format}
- **Style:** {style}
- **Language:** {lang} · **Aspect:** {ar} · **Length:** 15-30s
- **Platform:**

## Logline
(character + want + obstacle + twist, one sentence)

## Why it's funny / why it works
(the engine of the piece: tension, contrast, the joke)

## Beats
1. Hook (0-2s):
2.
3. Button:

## Characters
(who is on screen; existing bible characters or new ones to cast)

## Locations

## Tone and references
(what it should feel like; reference videos)
`;

const commands = {
  new() {
    throw new Error("flujo v5: los proyectos se crean con node engine/studio.mjs new (las 7 preguntas del intake)");
    const style = flag("--style");
    if (!slug || !style) throw new Error('usage: new <slug> --style <id> --title "..."');
    P.style(style); // must exist
    const dir = path.join(P.PROJECTS, slug);
    if (fs.existsSync(path.join(dir, "shotlist.json"))) throw new Error(`project ${slug} exists`);
    const sl = {
      slug, title: flag("--title", slug), format: flag("--format", "sitcom"), lang: flag("--lang", "en"), ar: flag("--ar", "9:16"),
      style, set: flag("--set") || undefined, phases: {}, captions: { marginV: 0.16 }, sfx: {}, overlays: [], shots: [],
    };
    P.writeJSON(path.join(dir, "shotlist.json"), sl);
    const vars = { title: sl.title, format: sl.format, style, lang: sl.lang, ar: sl.ar };
    fs.writeFileSync(conceptPath(slug), CONCEPT.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ""));
    console.log(`created projects/${slug}/ (shotlist.json, concept.md). Phase 1: write the concept, then: node engine/phase.mjs approve ${slug} concept`);
  },
  status() {
    throw new Error(`flujo v5: node engine/studio.mjs status ${slug}`);
    const sl = P.loadShotlist(slug);
    const st = P.style(sl.style);
    console.log(`${sl.title}  ·  style ${st.id} (${st.status || "draft"})  ·  ${sl.shots.length} shots  ·  spent $${(P.ledgerTotal(slug) * 0.005).toFixed(2)}\n`);
    let blocked = false;
    for (const ph of PHASES) {
      const s = phaseStatus(sl, ph.id);
      const mark = s.ok ? "✔" : blocked ? "·" : "▶";
      if (!s.ok && !blocked) blocked = true;
      console.log(`${mark} ${ph.name.padEnd(11)} ${s.ok ? "approved" : "open    "}  ${s.detail}`);
    }
    const next = PHASES.find((ph) => !phaseStatus(sl, ph.id).ok);
    if (next) console.log(`\nNext: ${next.name} — ${next.what}`);
  },
  approve() {
    throw new Error(`flujo v5: node engine/studio.mjs approve ${slug} <paso> --said "palabras exactas del creador"`);
    if (!["concept", "storyboard", "post", "retro"].includes(which)) {
      throw new Error("approve concept|storyboard|post|retro here. Style: style.mjs approve; cast/sets: cast.mjs approve / approve-set; look test: style.mjs winner.");
    }
    const sl = P.loadShotlist(slug);
    if (which === "concept" && /\(character \+ want/.test(fs.readFileSync(conceptPath(slug), "utf8"))) throw new Error("concept.md still has the template logline");
    if (which === "storyboard" && sl.format === "longform") {
      // Long-form has no storyboard: the gate is the plan (scenes, music, script) and its estimate.
      if (!sl.longform?.scenes?.length) throw new Error("long-form plan has no scenes");
    } else if (which === "storyboard") {
      const missing = sl.shots.filter((s) => !s.board?.file).map((s) => s.id);
      if (!sl.shots.length || missing.length) throw new Error(`storyboard incomplete: ${missing.join(", ") || "no shots"}`);
    }
    if (which === "post" && !sl.finalQc?.pass) throw new Error("final QC hasn't passed: node engine/qc.mjs final " + slug);
    // Check the estimate before approving, so a storyboard is never approved without a locked budget.
    if (which === "storyboard" && sl.bookEstimate == null) throw new Error(`no estimate yet: run node engine/${sl.format === "longform" ? "longform.mjs estimate" : "book.mjs"} ${slug} first`);
    approveProjectPhase(slug, which, flag("--note", ""));
    // Approving the Production Book approves its estimate as the project's spending ceiling (gen.mjs enforces it).
    if (which === "storyboard") {
      const s2 = P.loadShotlist(slug);
      const spent = P.ledgerTotal(slug);
      s2.budget = { approvedCredits: Math.ceil(spent + s2.bookEstimate), approvedAt: new Date().toISOString(), history: [{ add: s2.bookEstimate, note: "Production Book approved" }] };
      P.saveShotlist(slug, s2);
      console.log(`budget locked: ${s2.budget.approvedCredits} cr (${(s2.budget.approvedCredits * 0.005).toFixed(2)}) — anything beyond needs the creator's OK`);
    }
    console.log(`${which} approved for ${slug}`);
  },
  // Only after the creator explicitly approves extra spend (a reroll, a refilm):
  // phase.mjs budget <slug> --add <credits> | --usd <dollars> --said "..." (--add 2.52 once added 3 credits)
  budget() {
    const sl = P.loadShotlist(slug);
    const add = flag("--usd") ? Number(flag("--usd")) / 0.005 : Number(flag("--add", "0"));
    if (!add || !flag("--said")) throw new Error('usage: budget <slug> --add <credits> | --usd <dollars> --said "the creator\'s exact words"');
    if (!sl.flow?.v || sl.flow.archived) throw new Error(`${slug} no es un proyecto activo del flujo v5`);
    if (!sl.budget) throw new Error("no hay presupuesto todavía: se fija al aprobar el Production Book (studio.mjs approve <slug> book)");
    const hard = sl.intake?.budget?.mode === "fixed" && sl.intake.budget.usd ? sl.intake.budget.usd / 0.005 : null;
    if (hard != null && sl.budget.approvedCredits + Math.ceil(add) > hard) throw new Error(`el tope fijo del proyecto es ${sl.intake.budget.usd}: un aumento lo pasaría (cambia el tope en el intake solo si the creator lo dice)`);
    sl.budget.approvedCredits += Math.ceil(add);
    sl.budget.history.push({ add, said: flag("--said"), at: new Date().toISOString() });
    sl.flow.log = [...(sl.flow.log || []), { at: new Date().toISOString(), event: `budget +${add}`, said: flag("--said") }];
    P.saveShotlist(slug, sl);
    console.log(`budget now ${sl.budget.approvedCredits} cr ($${(sl.budget.approvedCredits * 0.005).toFixed(2)}); spent ${P.ledgerTotal(slug).toFixed(1)} cr`);
  },
};

try {
  if (!commands[cmd]) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
  commands[cmd]();
} catch (e) { console.error("ERROR:", e.message); process.exit(1); }
