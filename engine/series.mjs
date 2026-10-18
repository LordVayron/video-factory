#!/usr/bin/env node
// Series: everything a show reuses across episodes lives in series/<id>/ (series.json, brand, characters, sets,
// intro, sound). The intro is generated once per variant (day / night) and opens every episode.
//
//   node engine/series.mjs intro-assets <id> [--variant night]   street shot (Seedance), sounds (ElevenLabs), theme (Suno)
//   node engine/series.mjs intro <id> [--variant night]          cut series/<id>/intro/<variant>/ (intro.mp4, bed.wav, theme-stem.wav)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/env.mjs";
import * as kie from "./lib/kie.mjs";
import * as eleven from "./lib/eleven.mjs";
import { getModel } from "./lib/models.mjs";

const argv = process.argv.slice(2);
const [cmd, id] = argv;
if (!cmd || !id) { console.error("usage: series.mjs intro-assets|intro <id> [--variant day|night]"); process.exit(1); }
const dir = path.join(ROOT, "series", id);
const S = JSON.parse(fs.readFileSync(path.join(dir, "series.json"), "utf8"));
const I = S.intro;
const vi = argv.indexOf("--variant");
const variants = vi > -1 ? [argv[vi + 1]] : Object.keys(I.variants);
const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: dir, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(dir, f)]).toString());
const ledger = (label, model, credits) => {
  const f = path.join(ROOT, ".cache", "ledger-adhoc.json");
  const l = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
  l.push({ at: new Date().toISOString(), ok: true, label, model, credits });
  fs.writeFileSync(f, JSON.stringify(l, null, 2));
};

async function assets() {
  const jobs = [];
  // 1. The establishing shot per variant: the exterior plate brought to life (cars, people, slow push-in).
  for (const v of variants) {
    const V = I.variants[v];
    fs.mkdirSync(path.join(dir, "intro", v), { recursive: true });
    const out = path.join(dir, "intro", v, "street.mp4");
    if (fs.existsSync(out)) continue;
    const m = getModel(I.video.model);
    const req = { prompt: V.prompt, frame: await kie.upload(path.join(dir, V.frame)), res: I.video.res, ar: "9:16", duration: I.video.seconds, sound: false };
    const cr = m.cost(req);
    console.log(`→ ${v} street shot: ${m.label} ${I.video.res} ${I.video.seconds}s ~${cr.toFixed(1)} cr ($${(cr * 0.005).toFixed(3)})`);
    jobs.push(kie.run(m.modelFor ? m.modelFor(req) : m.model, m.build(req)).then(async (r) => {
      await kie.download(r.urls.find((u) => /\.mp4/i.test(u)) || r.urls[0], out);
      ledger(`${id} intro ${v} street shot`, m.model, cr);
    }));
  }
  // 2. Theme music (Suno, instrumental), shared by every variant; both takes kept, I.music.pick chooses.
  if (!fs.existsSync(path.join(dir, "intro", "theme-1.mp3"))) {
    const m = getModel("suno");
    console.log(`→ theme: ${m.label} ~${m.cost({})} cr`);
    jobs.push(kie.run(m.model, m.build({ prompt: I.music.prompt, title: `${S.title} theme`, duration: 30 })).then(async (r) => {
      const mp3 = r.urls.filter((u) => /\.mp3|audio/i.test(u));
      for (const [k, u] of mp3.slice(0, 2).entries()) await kie.download(u, path.join(dir, "intro", `theme-${k + 1}.mp3`));
      ledger(`${id} intro theme`, m.model, m.cost({}));
    }));
  }
  // 3. Street ambiences and the logo hit (ElevenLabs sound effects, free).
  for (const [name, spec] of Object.entries(I.sounds)) {
    const f = path.join(dir, "sound", `${name}.mp3`);
    if (!fs.existsSync(f)) jobs.push(eleven.sfx({ text: spec.prompt, seconds: spec.seconds, out: f }));
  }
  await Promise.all(jobs);
  for (const v of variants) console.log(v, fs.readdirSync(path.join(dir, "intro", v)).join(", "));
}

function buildIntro(v) {
  const V = I.variants[v];
  const W = 720, H = 1280, T = I.length, x = I.transition?.seconds ?? 0.4, tail = I.music.tail ?? 4;
  const out = (f) => path.join("intro", v, f);
  const logo = I.logo;
  const theme = path.join("intro", `theme-${I.music.pick || 1}.mp3`);
  // Logo: pops in with a small overshoot, holds, fades out.
  const lw = Math.round(W * logo.width);
  const t0 = logo.in, t1 = logo.out;
  const scaleExpr = `if(lt(t-${t0},0.12),0.6+3.9*(t-${t0}),if(lt(t-${t0},0.24),1.07-0.6*(t-${t0}-0.12),1))`;
  const ss = I.video.trimStart || 0;
  const video = [
    `[0:v]trim=${ss}:${ss + T},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1,` +
      `eq=contrast=0.96:saturation=0.95,scale=${W / 2}:${H / 2}:flags=area,scale=${W}:${H}:flags=bicubic,noise=alls=5:allf=t[bg]`,
    `[1:v]format=rgba,scale=${lw}:-1,fade=t=in:st=0:d=0.1:alpha=1,fade=t=out:st=${(t1 - t0 - 0.3).toFixed(2)}:d=0.3:alpha=1,setpts=PTS+${t0}/TB[lg0]`,
    `[lg0]scale=w='iw*${scaleExpr}':h=-1:eval=frame[lg]`,
    `[bg][lg]overlay=x=(W-w)/2:y=(H-h)/2-${Math.round(H * logo.raise)}:enable='between(t,${t0},${t1})':format=auto[v]`,
  ];
  // Audio as two stems so the episode can mix them under its first lines:
  //  bed   = street + logo hit, fading out through the dissolve;
  //  theme = the music, full during the titles, ducking as the first line starts, then fading out slowly over
  //          the next `tail` seconds under the dialogue (never cut off at the transition).
  const A = T - x, B = A + 0.5, E = T + tail;
  const env = `if(lt(t,${A}),1,if(lt(t,${B}),1-0.55*(t-${A})/0.5,max(0,0.45*(1-(t-${B})/${(E - B).toFixed(2)}))))`;
  const street = I.sounds[V.street];
  ff(["-i", path.join("sound", `${V.street}.mp3`), "-i", path.join("sound", "logo.mp3"), "-filter_complex",
    `[0:a]atrim=0:${T},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.3,afade=t=out:st=${(A - 0.2).toFixed(2)}:d=${(x + 0.2).toFixed(2)},volume=${street.gainDb}dB[st];` +
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round((t0 - 0.05) * 1000)}|${Math.round((t0 - 0.05) * 1000)},volume=${I.sounds.logo.gainDb}dB[hit];[st][hit]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "[a]", "-t", String(T), out("bed.wav")]);
  ff(["-i", theme, "-af", `atrim=${I.music.start}:${(I.music.start + E).toFixed(2)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.1,volume=${I.music.gainDb}dB,volume='${env}':eval=frame`, out("theme-stem.wav")]);
  // Preview file: the titles on their own.
  ff(["-i", out("street.mp4"), "-loop", "1", "-t", String(T), "-i", path.join("brand", "logo.png"), "-i", out("bed.wav"), "-i", out("theme-stem.wav"),
    "-filter_complex", video.join(";") + `;[2:a][3:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.79:level=false[a]`, "-map", "[v]", "-map", "[a]", "-t", String(T),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out("intro.mp4")]);
  console.log(path.join(dir, out("intro.mp4")), `${dur(out("intro.mp4")).toFixed(1)}s titles + ${tail}s music tail under scene 1`);
}

if (process.argv[1]?.endsWith("series.mjs")) {
  if (cmd === "intro-assets") await assets();
  else if (cmd === "intro") variants.forEach(buildIntro);
  else { console.error(`unknown command ${cmd}`); process.exit(1); }
}
