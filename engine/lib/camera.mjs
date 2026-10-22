// Camera kits: the optics a production is "shot" with and the moves its shots make. Two phases, like a real shoot:
// the optics (body look, lens, focal length, aperture) shape every still the video models start from (frames,
// storyboards, angle frames) and are restated briefly in each video prompt so the look holds; the move shapes only
// the video, one per shot. Optics are written as visible traits plus the real gear as a reference: image and video
// models follow focal length, aperture and lens character far more reliably than a camera brand alone.
//
// Each format has a recommended kit; the creator can pick any kit, change one part (lens, focal, aperture) for the
// whole film, or set a different kit or move on a single shot. Their choice is recorded in their words.
// Illustrated and stylized styles (storybook, anime) and styles with their own capture look (the 90s broadcast
// sitcom) take no optics: only framing and moves apply there.

export const BODIES = {
  "film-35": { label: "35mm motion picture film", prompt: "shot on 35mm motion picture film: fine soft grain, warm natural skin tones, gentle highlight roll-off" },
  "film-16": { label: "16mm film", prompt: "shot on 16mm film: visible film grain, limited tonal range, soft vintage contrast" },
  "digital-cinema": { label: "Digital cinema (ARRI Alexa 35)", prompt: "shot on an ARRI Alexa 35 digital cinema camera: clean, crisp, accurate neutral color, no grain, smooth highlights" },
  "large-format": { label: "Large-format cinema", prompt: "shot on a large-format cinema camera: rich detail, shallow natural depth, smooth tonality" },
  imax: { label: "IMAX 65mm", prompt: "shot on IMAX 65mm large-format film: immense resolution and detail, deep clean tonality, epic scale" },
  phone: { label: "Phone main camera", prompt: "shot on a phone's main camera: natural phone HDR, almost everything in focus, slightly tilted handheld framing, no cinematic color grade; it looks like a real candid phone photo" },
};

export const LENSES = {
  cooke: { label: "Cooke S4 (warm)", prompt: "Cooke S4 lens: warm, flattering skin, smooth gradual focus falloff" },
  zeiss: { label: "Zeiss Ultra Prime (clinical)", prompt: "Zeiss Ultra Prime lens: sharp, high-contrast, true color, no added character" },
  anamorphic: { label: "Panavision C-Series anamorphic", prompt: "Panavision C-Series anamorphic lens: oval bokeh, a subtle horizontal blue flare from bright light sources, slight barrel distortion at the edges", risk: "the flare can take over a shot without a strong light source in frame" },
  "canon-k35": { label: "Canon K-35 (vintage)", prompt: "vintage Canon K-35 lens: bright, soft warm texture, gentle natural flares" },
  helios: { label: "Helios 44 (swirl)", prompt: "vintage Helios 44 lens: swirling bokeh around the subject, a dreamlike edge softness" },
  diffusion: { label: "Diffusion filter (halation)", prompt: "a light diffusion filter: soft halation around highlights, gentle skin" },
  macro: { label: "Laowa macro", prompt: "Laowa macro lens: extreme close detail, very shallow depth, the background still hinted" },
  phone: { label: "Phone wide lens", prompt: "the phone's built-in wide lens" },
};

export const FOCALS = {
  14: "14mm ultra-wide: the whole setting, strong perspective",
  24: "24mm wide: the setting matters, natural for people at a distance",
  26: "26mm phone-wide view",
  35: "35mm: close to the human eye's perspective",
  40: "40mm: natural, slightly cinematic",
  50: "50mm: natural perspective, portrait-friendly",
  85: "85mm: flattering compression, the subject separated from the background",
  135: "135mm telephoto: strong compression, isolated subject",
};
export const APERTURES = {
  1.4: "f/1.4: very shallow depth of field, the background melts away",
  2.8: "f/2.8: shallow depth of field, the background softly out of focus",
  5.6: "f/5.6: moderate depth of field, the setting still readable",
  11: "f/11: deep focus, foreground and background sharp",
};

// Kits: a body, a lens, a focal length and an aperture that work together. `tested` lists side-by-side tests.
export const KITS = {
  "film-cooke": { label: "Film 35mm + Cooke S4", body: "film-35", lens: "cooke", focal: 50, aperture: 2.8, for: "people: drama, cinematic", tested: ["camera-test-1:B"] },
  "digital-zeiss": { label: "Digital cinema + Zeiss", body: "digital-cinema", lens: "zeiss", focal: 35, aperture: 5.6, for: "products, launch films, clean commercial", tested: ["camera-test-1:C"] },
  phone: { label: "Phone", body: "phone", lens: "phone", focal: 26, aperture: 11, for: "UGC, influencer, anything that must feel unproduced", tested: ["camera-test-1:D"] },
  anamorphic: { label: "Anamorphic large format", body: "large-format", lens: "anamorphic", focal: 40, aperture: 2.8, for: "cinematic, fantasy, epic", tested: ["camera-test-1:E"] },
  "vintage-16": { label: "16mm vintage", body: "film-16", lens: "helios", focal: 35, aperture: 2.8, for: "flashbacks, retro, indie looks", tested: ["camera-test-1:F"] },
  "imax-landscape": { label: "IMAX landscape", body: "imax", lens: "zeiss", focal: 24, aperture: 11, for: "landscapes, meditation, epic wides", tested: [] },
};

// The recommended kit per format (null: the style owns the look, only framing and moves apply).
export const RECOMMENDED = {
  "micro-drama": "film-cooke", cinematic: "film-cooke", fantasy: "anamorphic", influencer: "phone", ugc: "phone",
  podcast: "digital-zeiss", launch: "digital-zeiss", meditation: "imax-landscape", other: "film-cooke", sitcom: null, anime: null,
};

// Camera moves for the video phase. One per shot; `bold` moves work once per film.
export const MOVES = {
  static: { label: "Static", prompt: "The camera is on a locked tripod and does not move at all: no pan, no zoom, no push-in, no dolly." },
  "push-in": { label: "Slow push-in", prompt: "The camera slowly dollies in toward the subject on a smooth track, steady and continuous, ending closer on the subject." },
  "pull-out": { label: "Slow pull-out", prompt: "The camera slowly dollies back away from the subject on a smooth track, revealing more of the setting." },
  "truck-left": { label: "Truck left", prompt: "The camera glides sideways to the left on a track, parallel to the subject, at a steady pace." },
  "truck-right": { label: "Truck right", prompt: "The camera glides sideways to the right on a track, parallel to the subject, at a steady pace." },
  "pan-left": { label: "Pan left", prompt: "The camera stays in place and pans slowly to the left." },
  "pan-right": { label: "Pan right", prompt: "The camera stays in place and pans slowly to the right." },
  "tilt-up": { label: "Tilt up", prompt: "The camera stays in place and tilts slowly upward." },
  "tilt-down": { label: "Tilt down", prompt: "The camera stays in place and tilts slowly downward." },
  orbit: { label: "Orbit", prompt: "The camera arcs slowly around the subject at a constant distance, keeping them centered." },
  "crane-up": { label: "Crane up", prompt: "The camera rises smoothly on a crane, lifting above the scene to reveal it from higher." },
  "crane-down": { label: "Crane down", prompt: "The camera descends smoothly on a crane toward the subject." },
  handheld: { label: "Handheld", prompt: "Handheld camera with a subtle, natural micro-drift, as if held by an operator standing close; no shake." },
  follow: { label: "Follow", prompt: "The camera follows the subject at a constant distance as they move, keeping them in the same place in the frame." },
  "rack-focus": { label: "Rack focus", prompt: "The camera stays still while the focus shifts smoothly from the foreground to the background subject." },
  overhead: { label: "Overhead", prompt: "A top-down overhead camera looking straight down, holding steady." },
  "crash-zoom": { label: "Crash zoom", prompt: "A sudden fast crash zoom punches in on the subject's face at the key moment, then holds.", bold: true },
  "dolly-zoom": { label: "Dolly zoom (vertigo)", prompt: "A dolly zoom: the camera moves back while zooming in, so the subject stays the same size and the background stretches away.", bold: true },
  "whip-pan": { label: "Whip pan", prompt: "A fast whip pan with motion blur sweeps from one subject to the next.", bold: true },
  "fpv-drone": { label: "FPV drone", prompt: "An FPV drone flies fast and low through the space toward the subject in one continuous move.", bold: true },
};

const STYLE_OWNS_LOOK = (st) => !st || st.kind !== "realistic" || /retro-sitcom/.test(st.id || "");

// The rig of a shot: the project's kit (with its part overrides), then the shot's own kit or parts.
export function rigOf(sl, s = {}) {
  const pc = sl?.camera;
  if (!pc?.kit && !s.rig?.kit) return null;
  const base = KITS[s.rig?.kit || pc.kit];
  if (!base) return null;
  const pick = (k) => s.rig?.[k] ?? (s.rig?.kit ? undefined : pc?.[k]) ?? base[k];
  return { kit: s.rig?.kit || pc.kit, body: pick("body"), lens: pick("lens"), focal: pick("focal"), aperture: pick("aperture") };
}

// One sentence for a still (frame, storyboard, angle frame); "" when the style owns the look or no kit is chosen.
export function opticsFor(sl, s, st) {
  if (STYLE_OWNS_LOOK(st)) return "";
  const r = rigOf(sl, s);
  if (!r) return "";
  return `Camera and lens: ${BODIES[r.body]?.prompt}; ${LENSES[r.lens]?.prompt}; ${FOCALS[r.focal] || `${r.focal}mm`}; ${APERTURES[r.aperture] || `f/${r.aperture}`}.`;
}
// The same optics in a few words, for video prompts (the first frame carries the look; this keeps it).
export function opticsHold(sl, s, st) {
  if (STYLE_OWNS_LOOK(st)) return "";
  const r = rigOf(sl, s);
  return r ? `Keep the look of ${BODIES[r.body]?.label} with a ${r.focal}mm ${LENSES[r.lens]?.label.replace(/ \(.*\)$/, "")} lens at f/${r.aperture} throughout.` : "";
}
// The camera sentence for a video prompt: the catalog move, else the shot's own camera text.
export const moveText = (s) => (s?.move && MOVES[s.move] ? MOVES[s.move].prompt : s?.camera || "");
export const isStatic = (s) => (s?.move ? s.move === "static" : !s?.camera || /locked|static|tripod/i.test(s.camera));

// Rules (cast gate for the project kit, script gate for the shots).
export function cameraRules(sl) {
  const out = [];
  const pc = sl.camera;
  if (pc?.kit && !KITS[pc.kit]) out.push(`unknown camera kit "${pc.kit}" (${Object.keys(KITS).join(", ")})`);
  for (const [k, table] of [["body", BODIES], ["lens", LENSES], ["focal", FOCALS], ["aperture", APERTURES]]) if (pc?.[k] != null && !(String(pc[k]) in table)) out.push(`unknown ${k} "${pc[k]}"`);
  let bold = 0;
  for (const s of sl.shots || []) {
    if (s.move && !MOVES[s.move]) out.push(`${s.id}: unknown move "${s.move}" (${Object.keys(MOVES).join(", ")})`);
    if (s.rig?.kit && !KITS[s.rig.kit]) out.push(`${s.id}: unknown camera kit "${s.rig.kit}"`);
    if (MOVES[s.move]?.bold) bold++;
    const r = rigOf(sl, s);
    // A wide lens on a face distorts it; the creator can still ask for it on purpose (s.cameraOk.said).
    if (r && r.focal < 24 && /close|single|\bcu\b/i.test(s.framing || "") && (s.characters || []).length && !s.cameraOk?.said) out.push(`${s.id}: ${r.focal}mm on a close-up distorts the face; use 50-85mm (or s.cameraOk with the creator's words)`);
    if (/\b(and then|then the camera|while (?:panning|zooming|orbiting))\b/i.test(s.camera || "")) out.push(`${s.id}: two camera moves in one shot warp the picture; one move per shot (split the shot)`);
  }
  if (bold > 1 && !sl.camera?.boldOk?.said) out.push(`${bold} bold moves (crash zoom, dolly zoom, whip pan, FPV); one per film keeps its punch (or camera.boldOk with the creator's words)`);
  return out;
}

export const recommendedKit = (format) => RECOMMENDED[format] ?? null;
