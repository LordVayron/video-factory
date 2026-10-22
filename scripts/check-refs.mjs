// Offline checks of the reference engine: format guesses, the breakdown contract, approval in the
// creator's words, the bank, originality, and the studio gates. No video, no paid call: profiles are synthetic and a
// throwaway approved reference lives in refs/ only while the checks run.
import fs from "node:fs";
import path from "node:path";
import * as R from "../engine/lib/refs.mjs";
import * as F from "../engine/lib/flow.mjs";

export default function (t, ROOT) {
  const prof = (o = {}) => ({ duration: 30, size: "1280x720", orientation: "landscape", aspect: 1.778, avgShot: 2.5, cutsPerMin: 20, cuts: [10, 20], shotList: [{ n: 1, start: 0, end: 10, dur: 10 }, { n: 2, start: 10, end: 20, dur: 10 }, { n: 3, start: 20, end: 30, dur: 10 }], narration: { words: 80, wpm: 170, wordsPerSecondOfFilm: 2.7, coverage: 0.95, longestGap: 0.5, text: "there is too much to do and never enough time so we built a little town of helpers" }, hook: { firstWordAt: 0, text3s: "there is too much", words3s: 4, cutsIn3s: 1 }, loudness: { spread: 3 }, picture: { brightness: 180, saturation: 15 }, motion: { mean: 7, peak: 20 }, bed: { db: -28, music: true }, ...o });
  t("refs: the numbers suggest a format (launch, meditation, sitcom) and stay unsure about UGC vs influencer", R.guessFormat(prof()).format === "launch" && R.guessFormat(prof({ duration: 900, cutsPerMin: 0.5, motion: { mean: 1 }, narration: { ...prof().narration, wpm: 70 } })).format === "meditation" && R.guessFormat(prof({ orientation: "portrait", bed: { db: -12, music: true }, hook: { firstWordAt: 3 }, shotList: Array(8).fill(0).map((_, i) => ({ n: i + 1 })) })).format === "sitcom" && R.guessFormat(prof({ orientation: "portrait", cutsPerMin: 3, duration: 20, shotList: [{ n: 1 }] })).confidence < 0.7);

  const b = () => ({ format: "launch", formatWhy: "a launch film", summary: "a launch film summary", hook: { type: "pain", seconds: 3, text: "too much to do", why: "pain first" }, structure: [{ beat: "pain", from: 0, to: 10 }, { beat: "brand", from: 10, to: 30 }], shots: [1, 2, 3].map((n) => ({ n, what: "shot what", framing: "wide shot", camera: "static", action: "an action", ...(n < 3 ? { transitionOut: { type: "cut", how: "the hand carries the action" } } : {}) })), voice: { who: "a narrator", delivery: "fast and warm" }, music: { present: true, style: "bed", role: "under the voice" }, sfx: [], onScreenText: { style: "", examples: [] }, look: "flat 2D illustration", takeaways: ["one", "two", "three"], neverCopy: ["the characters"] });
  const noShot = b(); noShot.shots.pop(); noShot.shots[1].transitionOut = undefined;
  const late = b(); late.structure[1].to = 40;
  const quiet = b(); quiet.music.present = false;
  t("refs: a breakdown describes every measured shot and every join, keeps beats inside the video and matches the measured music", !R.breakdownRules(b(), prof()).length && R.breakdownRules(noShot, prof()).some((x) => /toma 3 sin describir/.test(x)) && R.breakdownRules(noShot, prof()).some((x) => /cómo se une/.test(x)) && R.breakdownRules(late, prof()).some((x) => /beat/.test(x)) && R.breakdownRules(quiet, prof()).some((x) => /música/.test(x)));

  const withText = prof({ onScreenText: [{ text: "SALE", from: 1, to: 2 }], sound: { sfx: [{ at: 4, jumpDb: 9 }] } });
  const plain = b(); plain.onScreenText = { style: "", examples: [] }; plain.sfx = [];
  t("refs: measured on-screen text and sound hits must be described in the breakdown", R.breakdownRules(plain, withText).some((x) => /texto en pantalla/.test(x)) && R.breakdownRules(plain, withText).some((x) => /golpes de sonido/.test(x)));
  const lib = fs.readFileSync(path.join(ROOT, "engine", "lib", "refs.mjs"), "utf8");
  t("refs: sound (tempo, hits outside the voice) and on-screen text (local OCR) are measured, not left to Claude", lib.includes('media("audio")') && lib.includes('media("ocr")') && fs.existsSync(path.join(ROOT, "engine", "lib", "ref_media.py")));
  t("refs: measuring again never undoes the creator's approval", lib.includes("re-measuring never undoes the creator's approval"));
  t("refs: a skill drives the engine from the creator's words (files or links, no commands)", fs.existsSync(path.join(ROOT, ".claude", "skills", "references", "SKILL.md")));
  // A throwaway reference, approved through the real gate.
  const id = `_check-ref-${process.pid}`, d = R.dirOf(id); fs.mkdirSync(d, { recursive: true });
  const w = (f, v) => fs.writeFileSync(path.join(d, f), JSON.stringify(v));
  w("meta.json", { id, status: "broken-down" }); w("profile.json", { ...prof(), guess: { format: "ugc", confidence: 0.5, why: [] } }); w("breakdown.json", b());
  let noWords = false, noFormat = false; try { R.approve(id, {}); } catch { noWords = true; } try { R.approve(id, { said: "check" }); } catch (e) { noFormat = /confirmación del creador/.test(e.message); }
  R.approve(id, { said: "check", formatSaid: "check" });
  t("refs: a reference enters the bank only in the creator's words, and the format too when the numbers disagreed", noWords && noFormat && R.approved("launch").includes(id));
  const bk = R.bank("launch");
  t("refs: the bank combines its references into ranges, hooks and takeaways", bk.refs.includes(id) && bk.ranges.wpm && bk.hooks.length && bk.takeaways.length >= 3);
  t("refs: chosen references become the reference a launch plan is calibrated to", R.asReference([id]).narration.wordsPerSecondOfFilm === 2.7);
  t("refs: a script that repeats a reference's phrases is caught; our own words pass", R.copyOverlap("there is too much to do and never enough time so we built", [id])[0].share > R.COPY_MAX && R.copyOverlap("Drop in your idea and the studio makes the film", [id])[0].share <= R.COPY_MAX);
  const sl = { format: "launch", flow: { approved: {} }, shots: [] };
  t("refs: the concept waits for the creator to choose references (or none) when the bank has some", F.refsGate(sl).length === 1 && !F.refsGate({ ...sl, refsChoice: { ids: [], said: "none" } }).length);
  t("refs: a concept approved before the bank had references stands", !F.refsGate({ ...sl, flow: { approved: { concept: { said: "x" } } } }).length);
  fs.rmSync(d, { recursive: true, force: true });
  t("refs: cut detection groups bursts and catches cuts between scenes of one palette", fs.readFileSync(path.join(ROOT, "engine", "lib", "reference.mjs"), "utf8").includes("scdet=threshold=7") && fs.readFileSync(path.join(ROOT, "engine", "lib", "reference.mjs"), "utf8").includes("< 0.35"));
  t("refs: speech is always transcribed and every shot and join gets its own sheet", fs.readFileSync(path.join(ROOT, "engine", "lib", "refs.mjs"), "utf8").includes("REF.words(src, lang)") && fs.readFileSync(path.join(ROOT, "engine", "lib", "refs.mjs"), "utf8").includes("join-${"));
  t("refs: links are downloaded with yt-dlp, files are copied; reference media stays out of git", fs.readFileSync(path.join(ROOT, "engine", "lib", "refs.mjs"), "utf8").includes('spawnSync("yt-dlp"') && fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8").includes("refs/**/source.*"));
}
