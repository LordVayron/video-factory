// Direction: the film language every vertical shares. Shot sizes and angles, the grammar of a cut, and how a shot list
// becomes sequences: one generation per scene (up to the model's longest clip) with its cuts designed in the prompt,
// instead of one generation per shot glued to the next (those cuts jumped). See docs/engine-v6.md.

// ---- shot sizes and angles
// Steps, widest first; 7 is a full-frame graphic (a card, a title), outside the ladder.
const SIZES = [
  [/\b(extreme|very)[- ]wide\b|\bestablishing\b|\bels\b|\bews\b/i, 0],
  [/\b(extreme|very)[- ]close|\becu\b|\binsert\b|\bdetail\b|\bmacro\b/i, 6],
  [/\bmedium[- ]close|\bmcu\b/i, 4],
  [/\bclose[- ]?up\b|\bclose\b|\bcu\b/i, 5],
  [/\bmedium[- ]wide\b|\bmedium[- ]long\b|\bcowboy\b|\bmws\b/i, 2],
  [/\bmedium\b|\bmid[- ]shot\b|\bms\b|\bwaist\b/i, 3],
  [/\bwide\b|\bfull[- ]shot\b|\blong[- ]shot\b|\bfull[- ]body\b|\bws\b|\bls\b/i, 1],
];
export const SIZE_NAMES = ["extreme wide", "wide", "medium wide", "medium", "medium close-up", "close-up", "extreme close-up", "graphic"];
export const shotSize = (s) => {
  const t = s?.shotType || s?.size || "";
  if (/\b(graphic|card|title|screen recording)\b/i.test(t)) return 7;
  for (const [re, n] of SIZES) if (re.test(t)) return n;
  return null;
};
const ANGLES = /\b(over[- ]the[- ]shoulder|ots|low[- ]angle|high[- ]angle|bird'?s[- ]eye|top[- ]down|overhead|profile|side view|reverse|pov|point of view|dutch|from behind|behind (?:him|her|them)|three[- ]quarter|frontal|head[- ]on|eye[- ]level)\b/gi;
export const anglesOf = (s) => new Set([...`${s?.shotType || ""} ${s?.composition || ""} ${s?.angle || ""}`.matchAll(ANGLES)].map((m) => m[0].toLowerCase().replace(/[- ]/g, "")));
// A visibly different view of the same place: another size, or another named angle.
export const newView = (a, b) => {
  const sa = shotSize(a), sb = shotSize(b);
  if (sa != null && sb != null && sa !== sb) return true;
  const x = anglesOf(a), y = anglesOf(b);
  return y.size > 0 && [...y].some((v) => !x.has(v));
};
// A camera that travels (a push, a pull, a pan): nobody cuts inside it.
export const moves = (s) => /\b(push|pull|dolly|track|pan|tilt|crane|orbit|arc|zoom|drift|follow|handheld|whip)/i.test(s?.camera || "") && !/\b(locked|static|still|tripod)\b/i.test(s?.camera || "");

// ---- grammar of a shot list, for any vertical
// shots: [{ id, place, shotType, angle?, camera, duration, unbroken? }]; unbroken: continues the previous shot without a cut.
export function grammar(shots, { minShot = 1, maxShot = 8, sizes = 3 } = {}) {
  const out = [], gen = shots.filter((s) => s.source !== "card" && s.source !== "still");
  for (const s of gen) if (shotSize(s) == null) out.push(`${s.id}: shotType "${s.shotType || ""}" names no shot size (${SIZE_NAMES.slice(0, 7).join(", ")})`);
  for (const s of gen) if (s.duration < minShot || s.duration > maxShot) out.push(`${s.id}: ${s.duration} s is outside the ${minShot}-${maxShot} s band for a shot of this format`);
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1], b = shots[i];
    if (b.unbroken || a.source === "card" || b.source === "card") continue;
    if (a.place && a.place === b.place && !newView(a, b)) out.push(`${b.id}: the same place, size and angle as ${a.id}: a jump cut. Cut to another size or angle, or continue ${a.id} unbroken`);
  }
  const used = new Set(gen.map(shotSize).filter((x) => x != null && x !== 7));
  if (gen.length >= 6 && used.size < sizes) out.push(`the film uses ${used.size} shot size(s); use at least ${sizes} so the cuts read as editing, not repetition`);
  for (let i = 3; i < shots.length; i++) {
    const run = shots.slice(i - 3, i + 1);
    if (run.every((x) => x.source !== "card" && x.source !== "still") && new Set(run.map(shotSize)).size === 1) out.push(`${run.map((x) => x.id).join(", ")}: four shots in a row at the same size`);
  }
  return out;
}

// ---- sequences
// The shot list becomes sequences: consecutive shots in one place generated in one call, up to the model's longest
// clip. A new place (a real scene change) starts a new sequence; cards and stills go to the editor.
// MODES. "camera" (the standard): one continuous take; the camera travels from each shot's view to the next (push in
// to the close-up, pull back to the wide), so a scene plays as one fluid piece with no cut inside it. "cuts": hard
// cuts inside one generation, only for a model whose sequence test showed it really cuts.
// A sequence over the model's length splits; the next part continues the previous take (opens on its last frame).
export const MODES = ["camera", "cuts"];
export const DEFAULT_MODE = "camera";
// maxContinue: at most this many sequences in a row open on a take's last frame; the next one opens on a freshly drawn,
// judged keyframe, so a face can't drift from copy to copy.
export const MAX_CONTINUE = 2;
export function planSequences(shots, { maxSecs = 15, mode = DEFAULT_MODE, multiShot = true, maxContinue = MAX_CONTINUE } = {}) {
  const seqs = [];
  let cur = null;
  const together = mode === "camera" || multiShot;
  const close = () => { if (cur) seqs.push(cur); cur = null; };
  for (const s of shots) {
    if (s.source === "card" || s.source === "still") { close(); seqs.push({ id: `Q${seqs.length + 1}`, shots: [s.id], place: s.place || null, start: s.start, duration: s.duration, editor: true }); continue; }
    const fits = cur && together && cur.place === s.place && cur.duration + s.duration <= maxSecs + 1e-6;
    if (!fits) {
      const prev = cur;
      close();
      const depth = prev?.continues ? (prev.depth || 1) : 0;
      const goesOn = prev && prev.place === s.place && (s.unbroken || mode === "camera") && depth < maxContinue;
      cur = { id: `Q${seqs.length + 1}`, mode, shots: [], place: s.place || null, start: s.start, duration: 0, ...(goesOn ? { continues: prev.id, depth: depth + 1 } : {}) };
    }
    cur.shots.push(s.id);
    cur.duration = +(cur.duration + s.duration).toFixed(3);
  }
  close();
  return seqs;
}

// Where each shot's view begins inside its sequence (the editor splits a passing take there).
export const beatsOf = (seq, byId) => { let t = 0; return seq.shots.map((id) => { const a = +t.toFixed(3); t += byId[id].duration; return a; }); };

// Cut times inside a sequence, in seconds from its start (none in a continuous camera sequence).
export const cutsOf = (seq, byId) => {
  if ((seq.mode || DEFAULT_MODE) === "camera") return [];
  let t = 0;
  const cuts = [];
  seq.shots.forEach((id, i) => { if (i && !byId[id].unbroken) cuts.push(+t.toFixed(3)); t += byId[id].duration; });
  return cuts;
};

// Video models paint any word an action names on a screen; screens carry shapes, icons and colors only (the editor
// composites every exact word).
const SCREEN_RULE = "Every screen and device shows only shapes, icons, colors and blurred interface, never readable words, letters or numbers.";

// The prompt of one sequence. Camera mode: one continuous shot whose camera moves from view to view at the given
// times, with each beat's action. Cuts mode: every shot with its timing and the hard cuts.
export function sequencePrompt(seq, byId, { style = "", continuity = [], cast = [] } = {}) {
  const mode = seq.mode || DEFAULT_MODE;
  let t = 0;
  const parts = seq.shots.map((id, i) => {
    const s = byId[id], a = t, b = +(t + s.duration).toFixed(2);
    t = b;
    const view = [SIZE_NAMES[shotSize(s)] || s.shotType, s.angle].filter(Boolean).join(", ");
    const act = (s.action || s.prompt || "").trim();
    const actS = act ? ` ${act.replace(/[.!]?$/, ".")}` : "";
    if (mode === "camera") return i
      ? `From ${a.toFixed(1)} s to ${b.toFixed(1)} s the camera moves smoothly, without a cut, to a ${view} view${s.camera ? ` (${s.camera})` : ""}:${actS}`
      : `From 0.0 s to ${b.toFixed(1)} s: ${view} view${s.camera ? `, camera ${s.camera}` : ""}.${actS}`;
    return `Shot ${i + 1} (${a.toFixed(1)}-${b.toFixed(1)} s${i && !s.unbroken ? ", hard cut in" : i ? ", same take continues" : ""}): ${[view, s.camera ? `camera ${s.camera}` : ""].filter(Boolean).join(", ")}.${actS}`;
  });
  const n = mode === "camera" ? 0 : seq.shots.filter((id, i) => i && !byId[id].unbroken).length;
  return [
    mode === "camera"
      ? `A ${seq.duration.toFixed(1)}-second scene filmed as ONE continuous shot: no cuts, no edits, the camera keeps rolling and travels between the views at the times given.`
      : `A ${seq.duration.toFixed(1)}-second sequence ${n ? `in ${seq.shots.length} shots with ${n} hard cut${n > 1 ? "s" : ""}, at exactly the times given` : "in one continuous shot, no cuts"}.`,
    ...parts,
    cast.length ? `The same people throughout, exactly as in their reference sheets: ${cast.join("; ")}.` : "",
    continuity.length ? `The set, light, wardrobe and props stay the same throughout: ${continuity.join("; ")}.` : "The set, light, wardrobe and props stay the same throughout.",
    style,
    SCREEN_RULE,
    mode === "camera" ? "No cuts, no transitions, no fades, no text or logos drawn in the picture." : "No other cuts, no transitions, no fades, no text or logos drawn in the picture.",
  ].filter(Boolean).join(" ");
}

// The shot list in direction terms, for any clips vertical. A launch film keeps its camera language in the plan
// (size, angle, move, place, unbroken); other verticals keep it on the shot.
export function directionShots(sl, plan = null, environments = []) {
  const planned = Object.fromEntries((plan?.shots || []).map((p) => [p.id, p]));
  const envs = new Set(environments.map((e) => e.id));
  return (sl.shots || []).map((s) => {
    const p = planned[s.id] || {};
    const place = s.place || p.place || (p.assets || []).find((a) => envs.has(a)) || null;
    return {
      id: s.id, source: s.source || p.source || "generate", start: s.planned?.start ?? p.start ?? s.start ?? 0, duration: s.duration ?? p.duration,
      shotType: s.shotType || p.shotType, angle: s.angle || p.angle, camera: s.camera || p.camera, place,
      unbroken: (s.chain || p.chain) === "exact" || /^@w+:last$/.test(s.frame || ""), action: s.prompt, characters: s.characters || [],
    };
  });
}

// Shot length bands per clips vertical (seconds): talking formats hold longer, ads and influencer clips cut faster.
export const SHOT_BANDS = { ugc: [1, 6], influencer: [1, 8], podcast: [2, 15], cinematic: [1.5, 8], fantasy: [1.5, 8], launch: [1.5, 5.5], other: [1, 10] };

// The shots that open a sequence on a drawn keyframe (the rest are reached by the camera, or continue a take).
export const keyShots = (seqs) => new Set(seqs.filter((q) => !q.editor && !q.continues).map((q) => q.shots[0]));
