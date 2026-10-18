// Continuity logic for a shotlist: where every character is, shot by shot, and whether every change of place
// is shown on screen. A character may only change place in a shot that carries a `moves` entry describing how
// ("hops off the couch onto the rug"); after that shot the new place holds until the next move.
//
// Scene: seats = { <char>: { place: "the LEFT cushion of the plaid couch", side: "left" } }   (state at scene start)
// Shot:  moves = { <char>: { to: "the rug in front of the couch", side: "right", how: "hops down off the couch" } }
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";
import { character } from "./project.mjs";

const key = (p) => (p ? `${String(p.place).toLowerCase().replace(/\s+/g, " ").trim()}|${p.side}` : "");

// Returns { states: { shotId: { char: place } }, problems: [] }.
export function planCheck(sl) {
  const problems = [];
  const states = {};
  let state = null;
  for (const sc of sl.scenes || []) {
    if (!sc.seats) { problems.push(`scene ${sc.id}: no "seats" (where each character is at the start of the scene)`); continue; }
    // A scene marked timeJump ("the next morning") starts fresh: nobody has to be shown moving across the cut.
    if (sc.timeJump) state = null;
    if (state) {
      for (const [id, p] of Object.entries(sc.seats)) {
        if (state[id] && key(state[id]) !== key(p)) {
          problems.push(`scene ${sc.id}: ${character(id).name} starts on "${p.place}" (${p.side}) but the last shot left them on "${state[id].place}" (${state[id].side}); add a shot with moves.${id} showing how they got there`);
        }
      }
    }
    state = { ...(state || {}), ...sc.seats };
    for (const sid of sc.shots) {
      const s = sl.shots.find((x) => x.id === sid);
      if (!s) continue;
      for (const [id, m] of Object.entries(s.moves || {})) {
        if (!m.how) problems.push(`${s.id}: ${character(id).name} moves to "${m.to}" without saying how (moves.${id}.how)`);
        if (!/move|walk|hop|jump|leap|climb|stand|sit|run|sprint|dash|crawl|step|slide|enter|exit|follow|head|go|rush|bolt/i.test(`${s.motion} ${m.how}`)) problems.push(`${s.id}: the shot's action never shows ${character(id).name} moving`);
        state = { ...state, [id]: { place: m.to, side: m.side || state[id]?.side } };
      }
      for (const c of s.characters || []) if (!state[c]) problems.push(`${s.id}: ${character(c).name} is on screen but has no place in the scene's seats`);
      states[s.id] = { ...state };
    }
  }
  // Pre-production: the set plate the video model will see must match each scene's time of day (a past production: a
  // daytime dining-room plate pulled night wides to the wrong angle and into daylight).
  // Each scene is checked against its own set (sc.set) or the project's.
  for (const sc of sl.scenes || []) {
    const setId = sc.set || sl.set;
    let set;
    try { set = JSON.parse(fs.readFileSync(path.join(ROOT, "bible", "sets", setId, "set.json"), "utf8")); } catch { continue; }
    const plate = (set.plates || [])[0], meta = set.platesMeta?.[plate];
    if (!meta) { problems.push(`set "${setId}": primary plate ${plate} has no platesMeta (angle, time)`); continue; }
    const night = /night/i.test(sc.lighting || "");
    if (night !== (meta.time === "night")) problems.push(`scene ${sc.id} is ${night ? "night" : "day"} but the set plate ${plate} is ${meta.time} (${meta.angle})`);
  }
  return { states, problems };
}

// The text every prompt gets for a shot: where everyone is at that moment.
export function placesText(sl, shotId) {
  const st = planCheck(sl).states[shotId];
  if (!st) return "";
  return Object.entries(st).map(([id, p]) => `${character(id).name} is on ${p.place} (frame ${String(p.side).toUpperCase()})`).join("; ");
}
