// Flow v5 checks for scripts/check.mjs: every lock stays in place. Offline, no spend.
// A throwaway project is created under projects/ and removed at the end.
import fs from "node:fs";
import path from "node:path";
import * as F from "../engine/lib/flow.mjs";
import * as P from "../engine/lib/project.mjs";
import { decide } from "./hooks/guard.mjs";

export default function checkFlow(t, ROOT) {
  const engine = (f) => fs.readFileSync(path.join(ROOT, "engine", f), "utf8");
  const stops = (fn) => { try { fn(); return false; } catch (e) { return e instanceof F.FlowStop; } };
  t("no --force anywhere in the engine", !["gen.mjs", "edit.mjs", "cut.mjs", "studio.mjs", "longform.mjs", "book.mjs"].some((f) => engine(f).includes('"--force"')));
  t("no command still uses the retired requirePhases gate", !fs.readdirSync(path.join(ROOT, "engine")).filter((f) => f.endsWith(".mjs")).some((f) => /requirePhases\(sl/.test(engine(f))));
  for (const [f, step] of [["gen.mjs", 'requireStep(sl, "film", "gen clip")'], ["gen.mjs", 'requireStep(sl, "board", "gen storyboard")'], ["edit.mjs", "requireStep(sl, draft"], ["cut.mjs", "requireStep(sl, draft"], ["radio.mjs", 'requireStep(sl, "radio"'], ["animatic.mjs", 'requireStep(sl, "board"'], ["longform.mjs", 'requireStep(sl, "edit"'], ["book.mjs", "F.requireStep(sl"]])
    t(`${f} is gated (${step.slice(0, 40)})`, engine(f).includes(step));
  t("job() refuses projects outside flow v5", engine("gen.mjs").includes("assertV5(sl0)"));
  t("job() refuses video spend without the locked budget", engine("gen.mjs").includes('if (cap == null && !["image", "voice"].includes(m.kind)) throw'));

  const slug = `_check-${process.pid}`, d = path.join(P.PROJECTS, slug);
  try {
    P.writeJSON(path.join(d, "shotlist.json"), { slug, title: "check", format: "influencer", ar: "9:16", lang: "en", style: "hyperreal", shots: [] });
    t("a project without flow v5 cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, archived: "test" }; });
    t("an archived project cannot run anything", stops(() => F.requireStep(P.loadShotlist(slug), "board")));
    P.updateShotlist(slug, (x) => { x.flow = { v: 5, approved: {}, overrides: [], log: [] }; x.intake = { series: "single", format: "influencer", start: "idea", platform: {}, cast: "none", budget: {}, refs: {} }; });
    fs.writeFileSync(path.join(d, "concept.md"), "# c");
    t("filming waits for every step before it", stops(() => F.requireStep(P.loadShotlist(slug), "film")));
    t("an approval needs the creator's words", stops(() => F.approve(slug, "concept", "")));
    F.approve(slug, "concept", "check");
    t("an approval moves the flow forward", F.stepStatus(P.loadShotlist(slug), "concept").ok);
    fs.appendFileSync(path.join(d, "concept.md"), "\nchanged");
    t("changing an approved step reopens it", !F.stepStatus(P.loadShotlist(slug), "concept").ok);
    t("a clips project with zero shots has nothing filmed", !F.stepStatus(P.loadShotlist(slug), "film").ok);
    t("a take that failed an eval is not usable", !F.takeOk({ evals: { identity: { pass: true }, jumps: { internal: 1 }, dialogue: { pass: true } } }));
    t("a take the creator accepted in his words is usable", F.takeOk({ evals: { identity: { pass: false } }, accepted: { said: "sí" } }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // The Claude Code guard (.claude/settings.json → scripts/hooks/guard.mjs).
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "settings.json"), "utf8"));
  t("the guard hook is configured", JSON.stringify(settings.hooks?.PreToolUse || []).includes("scripts/hooks/guard.mjs"));
  const runner = path.join(ROOT, ".cache", `_runner-${process.pid}.mjs`);
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(runner, ["import * as k from", '"../engine/lib/' + "kie.mjs\";", "await k.create" + 'Task("x", {});'].join(" "));
  const g = (tool, input) => !!decide({ tool_name: tool, tool_input: input });
  t("guard denies a one-off runner script that calls Kie", g("Bash", { command: `node "${runner}"` }));
  fs.rmSync(runner, { force: true });
  t("guard denies inline speech-to-speech", g("Bash", { command: "node --input-type=module -e \"import { sts } from './engine/lib/" + "eleven.mjs'; await sts({})\"" }));
  t("guard denies curl to Kie", g("PowerShell", { command: "curl https://api." + "kie.ai/api/v1/jobs/createTask" }));
  t("guard denies writing a runner outside the engine", g("Write", { file_path: path.join(ROOT, ".cache", "x.mjs"), content: 'import * as kie from "../engine/lib/' + 'kie.mjs"' }));
  t("guard allows a Python doc script that only names an engine module", !g("Write", { file_path: path.join(ROOT, ".cache", "docs.py"), content: "s = \"see lib/" + "identity.mjs\"" }));
  t("guard denies a Python script that calls Kie directly", g("Write", { file_path: path.join(ROOT, ".cache", "x.py"), content: "requests.post(\"https://api." + "kie.ai/x\")" }));
  t("guard allows engine commands", !g("Bash", { command: "node engine/gen.mjs clip demo --shot B" }));
  t("guard allows engine code", !g("Write", { file_path: path.join(ROOT, "engine", "lib", "x.mjs"), content: "kie." + "upload(f)" }));
  t("guard denies sending a video with no receipt", g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x.mp4")] }));
  t("guard allows a labelled preview", !g("SendUserFile", { files: [path.join(ROOT, "projects", "no-such", "out", "x-PREVIEW.mp4")] }));
}
