// Guided meditation videos for YouTube: a voice-over, a soundtrack and a looping image that shows the meditation's
// premise. One universal engine; the intention (sleep, anxiety, higher self, morning...) only changes the numbers.
// Research and sources: .claude/skills/studio/references/verticals/meditation-longform.md.
//
// Every intention sets the voice pace, the pauses, the share of the runtime that is voice, the music tempo, how the
// piece ends, and the safety lines it must carry. `meditationRules(sl)` blocks the script gate on anything outside
// them; `voicePace(cues, intent)` checks the recorded narration in the build.

export const INTENTS = {
  sleep: {
    label: "Sleep", technique: "release-only body scan, slow countdown, plot-free visualization; boring on purpose",
    wpm: [80, 100], pause: [6, 20], voiceShare: [0.2, 0.45], bpm: [60, 72], ending: "fade",
    picture: "night or blue-hour, dark low-contrast palette, one slow steady motion (mist, rain, stars, snow)",
    safety: [/driving|operating (heavy )?machinery/i], safetyText: "If you are driving, please stop listening.",
  },
  anxiety: {
    label: "Anxiety and stress relief", technique: "breath with a long exhale or box breathing, grounding through touch and the senses (5-4-3-2-1), naming without judging",
    wpm: [95, 120], pause: [4, 12], voiceShare: [0.35, 0.55], bpm: [60, 75], ending: "return",
    picture: "soft daylight or overcast nature, water, open sky; steady and safe, nothing looming",
    safety: [/stop|pause|return to (your )?normal breath/i], safetyText: "If anything feels like too much, you can open your eyes and breathe normally at any time.",
  },
  "higher-self": {
    label: "Higher self, inner guide, finding yourself", technique: "settle, go inward along a path (stairs, door, garden, temple of light), meet a wise presence or your future self, receive a word or an image, bring it back",
    wpm: [90, 115], pause: [6, 18], voiceShare: [0.35, 0.5], bpm: [60, 72], ending: "return",
    picture: "luminous sanctuary, light rays, cosmic sky, temple or forest clearing; awe without spectacle",
    safety: [], safetyText: "",
  },
  manifestation: {
    label: "Manifestation and affirmations", technique: "present-tense \"I am\" affirmations with space to repeat them, vivid sensory picture of the life wished for",
    wpm: [100, 125], pause: [3, 10], voiceShare: [0.35, 0.55], bpm: [65, 85], ending: "return",
    picture: "golden hour, sunrise, open horizon, warm light",
    safety: [], safetyText: "",
  },
  morning: {
    label: "Morning and energy", technique: "posture and breath, gratitude, one intention for the day, eyes open at the end",
    wpm: [110, 135], pause: [3, 8], voiceShare: [0.45, 0.65], bpm: [70, 95], ending: "return",
    picture: "sunrise, fresh bright light, dew, open windows",
    safety: [], safetyText: "",
  },
  "self-love": {
    label: "Self-love, healing, gratitude", technique: "heart-centred breathing, loving-kindness phrases (may I be...), warmth spreading through the body",
    wpm: [90, 115], pause: [5, 14], voiceShare: [0.35, 0.5], bpm: [60, 75], ending: "return",
    picture: "warm soft light, flowers, candle glow, a sheltered garden",
    safety: [/stop|pause|at any time/i], safetyText: "Go gently. You can pause at any time.",
  },
  breathwork: {
    label: "Breathwork", technique: "counted breaths (box 4-4-4-4, long exhale 4-6), a clear count, rest between rounds",
    wpm: [95, 120], pause: [4, 16], voiceShare: [0.4, 0.6], bpm: [60, 75], ending: "return",
    picture: "simple, steady and spacious: horizon, still water, slow clouds",
    safety: [/lightheaded|dizzy/i], safetyText: "If you feel lightheaded, return to your normal breath.",
  },
  focus: {
    label: "Focus and study", technique: "a short spoken settle-in, then music and the image carry the session",
    wpm: [100, 125], pause: [3, 12], voiceShare: [0, 0.15], bpm: [60, 90], ending: "return",
    picture: "a calm desk, library, rain on a window, soft lamp light",
    safety: [], safetyText: "",
  },
};

import { spawnSync } from "node:child_process";
const words = (t) => (t || "").trim().split(/\s+/).filter(Boolean).length;
// What a looping meditation picture must never ask for: attention, a face to look back at, text to read, speed.
const PICTURE_BAD = /\b(face|faces|portrait|looking at (the )?(camera|viewer)|person|people|man|woman|girl|boy|text|title|words|logo|letters?|watermark)\b/i;
const MOTION_BAD = /\b(fast|quick(ly)?|rapid(ly)?|sudden(ly)?|zoom(s|ing)? in|whip|explod\w*|flash(es|ing)?|running|crash\w*|strobe|spinning|enters?|leaves? the frame|walks? (in|out|into))\b/i;
const MUSIC_BAD = /\b(drums?|beat drop|trap|edm|rap|vocals?|lyrics|singing|choir with words)\b/i;

export const intentOf = (sl) => INTENTS[sl.longform?.intent];

// How much a loop actually moves: the mean luma difference between consecutive frames at 320 px (0-255 scale).
// A loop asked for first frame = last frame can come back frozen (around 0.09) and reads as a still picture. Ambient
// motion that reads on screen measures about 0.3 and up.
export const MIN_MOTION = 0.3;
export function motionScore(file) {
  const e = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", "scale=320:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr || "";
  const v = [...e.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : 0;
}
export const isDemo = (L) => !!L?.demo;

// The script gate for a meditation: intention, premise, picture, music, script density, pauses and safety.
export function meditationRules(sl) {
  const L = sl.longform || {}, out = [];
  const I = intentOf(sl);
  if (!I) return [`falta longform.intent (${Object.keys(INTENTS).join(", ")})`];
  if (!L.premise?.trim()) out.push("falta longform.premise: la idea de la meditación en una frase; las imágenes salen de ahí");
  for (const sc of L.scenes || []) {
    if (!sc.premiseLink?.trim()) out.push(`escena ${sc.id}: falta premiseLink (qué parte de la meditación muestra esta imagen)`);
    // "no people", "no text" are instructions to the image model, not people in the picture
    // The creator's own image is their call: it is not linted, only animated (longform.mjs image).
    const pic = sc.imageBy === "creator" ? "" : String(sc.picture || "").replace(/\bno (\w+ )?(people|person|faces?|text|words|letters|logos?|watermarks?)\b/gi, "");
    if (PICTURE_BAD.test(pic)) out.push(`escena ${sc.id}: la imagen pide "${pic.match(PICTURE_BAD)[0]}"; una imagen en loop no lleva caras, personas ni texto`);
    if (sc.motion !== "kenburns" && MOTION_BAD.test(sc.motion || "")) out.push(`escena ${sc.id}: el movimiento "${(sc.motion || "").match(MOTION_BAD)[0]}" rompe el loop; un solo movimiento lento y constante`);
  }
  const mp = L.music?.prompt || "";
  const bpm = Number((mp.match(/(\d{2,3})\s*bpm/i) || [])[1]);
  if (!bpm) out.push(`la música no dice su tempo; pide ${I.bpm[0]}-${I.bpm[1]} bpm para ${I.label}`);
  else if (bpm < I.bpm[0] || bpm > I.bpm[1]) out.push(`música a ${bpm} bpm; ${I.label} va de ${I.bpm[0]} a ${I.bpm[1]} bpm`);
  const musicClean = mp.replace(/\bno (\w+ )?(drums?|vocals?|lyrics|singing)\b/gi, "");
  if (MUSIC_BAD.test(musicClean)) out.push(`la música pide "${musicClean.match(MUSIC_BAD)[0]}"; meditación = instrumental, sin batería ni voces`);
  if (!/instrumental|no vocals/i.test(mp)) out.push('la música debe pedir "instrumental, no vocals"');
  const segs = (L.script || []).filter((s) => s.text?.trim());
  if (!L.voiceFree && !segs.length) out.push("sin guion de voz (o longform.voiceFree: true)");
  // A demo must let the guiding voice be heard: 2-5 s of music between lines, not the full
  // piece's long silences.
  const pause = isDemo(L) ? [2, 5] : I.pause;
  for (const [i, s] of segs.entries()) {
    const p = s.pauseAfter ?? 4, last = i === segs.length - 1;
    if (!last && p < pause[0]) out.push(`segmento ${i + 1}: pausa de ${p} s; ${isDemo(L) ? "un demo" : I.label} pide ${pause[0]}-${pause[1]} s entre frases`);
    if (!last && isDemo(L) && p > pause[1]) out.push(`segmento ${i + 1}: pausa de ${p} s en un demo; máximo ${pause[1]} s para que se oiga la voz guiada`);
    if (L.scriptBy !== "creator" && words(s.text) > 30) out.push(`segmento ${i + 1}: ${words(s.text)} palabras; una frase por respiración (máximo ~30)`);
  }
  // The creator's written meditation reaches the voice word for word: an edit to the segments is refused.
  if (L.scriptBy === "creator") {
    const norm = (t) => String(t).replace(/\[pause[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
    if (norm(segs.map((s) => s.text).join(" ")) !== L.scriptSource) out.push("el guion del creador cambió; su meditación va palabra por palabra (vuelve a importarla con longform.mjs script)");
  }
  // Voice share of the runtime, estimated at the intention's mid pace (the build measures the real one).
  const mid = (I.wpm[0] + I.wpm[1]) / 2;
  const voiceSec = segs.reduce((n, s) => n + (words(s.text) / mid) * 60, 0);
  const total = isDemo(L) ? (L.seconds || 25) : (L.minutes || 0) * 60 || voiceSec + segs.reduce((n, s) => n + (s.pauseAfter ?? 4), 0);
  if (total && segs.length && !isDemo(L)) {
    const share = voiceSec / total;
    if (share > I.voiceShare[1] + 0.05) out.push(`la voz ocupa ~${Math.round(share * 100)} % del tiempo; ${I.label} va a ${Math.round(I.voiceShare[0] * 100)}-${Math.round(I.voiceShare[1] * 100)} % (más silencio o menos texto)`);
    if (share < I.voiceShare[0] - 0.05) out.push(`la voz ocupa ~${Math.round(share * 100)} % del tiempo; ${I.label} va a ${Math.round(I.voiceShare[0] * 100)}-${Math.round(I.voiceShare[1] * 100)} % (falta guion para ${L.minutes} min)`);
  }
  if (isDemo(L)) {
    const secs = L.seconds || 25, n = segs.reduce((k, s) => k + words(s.text), 0);
    if (secs < 15 || secs > 30) out.push(`demo de ${secs} s; un demo va de 15 a 30 s`);
    if (n > Math.round((secs - 5) * (I.wpm[1] / 60))) out.push(`demo de ${secs} s con ${n} palabras; caben ~${Math.round((secs - 5) * (I.wpm[1] / 60))} a ${I.wpm[1]} wpm`);
  } else if (I.safety.length && !I.safety.every((re) => segs.some((s) => re.test(s.text)))) {
    out.push(`falta la línea de seguridad de ${I.label}: "${I.safetyText}"`);
  }
  if (L.darkAfter != null && I.ending !== "fade") out.push(`pantalla negra (darkAfter) es para meditaciones que no regresan (dormir); ${I.label} regresa al final`);
  return out;
}

// Recorded narration against the intention's pace: words per minute of each segment's own audio.
export function voicePace(cues, intent) {
  const I = INTENTS[intent];
  if (!I || !cues?.length) return { wpm: null, issues: [] };
  const w = cues.reduce((n, c) => n + words(c.text), 0), sec = cues.reduce((n, c) => n + c.d, 0);
  const wpm = Math.round(w / (sec / 60));
  const issues = [];
  if (wpm > I.wpm[1] + 10) issues.push(`la voz va a ${wpm} wpm; ${I.label} pide ${I.wpm[0]}-${I.wpm[1]} (baja voice.settings.speed y vuelve a generar la narración)`);
  if (wpm < I.wpm[0] - 15) issues.push(`la voz va a ${wpm} wpm; ${I.label} pide ${I.wpm[0]}-${I.wpm[1]} (suena arrastrada)`);
  return { wpm, issues };
}

// The YouTube package: a literal, search-shaped title, chapters from the narration cues, the AI disclosure.
export function youtubePackage(sl, cues = []) {
  const L = sl.longform || {}, I = intentOf(sl) || { label: "Guided meditation" };
  const mins = Math.round(L.minutes || 0);
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const chapters = (L.chapters || []).length ? L.chapters : [];
  const length = isDemo(L) ? " (Preview)" : mins ? `, ${mins} Minute${mins === 1 ? "" : "s"}` : "";
  const title = L.youtubeTitle || `${sl.title}: Guided ${I.label} Meditation${length}${L.darkAfter != null ? ", Dark Screen" : ""}`;
  return [
    `# ${title}`, "",
    L.premise || "", "",
    ...(chapters.length ? ["Chapters", ...chapters.map((c) => `${mmss(c.at)} ${c.title}`), ""] : []),
    "Voice-over, soundtrack and visuals were made with AI tools. On YouTube, answer \"yes\" to \"altered or synthetic content\" only if a realistic person or event is shown; a painted or ambient scene is usually exempt. Check the current rule before you publish.",
    "This meditation is for relaxation, not medical treatment.",
    "", `Tags: guided meditation, ${I.label.toLowerCase()}, ${(L.tags || []).join(", ")}`,
    "", `Narration cues: ${cues.length}`,
  ].join("\n");
}
