// Frame eval: every drawn frame is judged against the set map, the props/set sheets, the character sheets and the
// setting's anchor frame before anyone sees it. A frame that moves, mirrors, redesigns or merges an object, breaks
// physics (tangled or shared mounts), changes a face or shows a device in the wrong state fails.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { judgeJSON } from "./judge.mjs";

const jpeg = (f, w = 1024) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-vf", `scale='min(${w},iw)':-2`, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64");
const img = (data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });

// refs: [{ label, file }] (character sheets, set sheet, props sheet, anchor frame), in the order they are shown.
// maps: the set maps of the shot's settings. expect: what this exact frame must show (the shot's prompt or end).
export async function evalFrame({ frame, refs = [], maps = [], cast = [], expect = "" }) {
  const content = [];
  for (const r of refs.filter((r) => r.file && fs.existsSync(r.file))) content.push({ type: "text", text: `Reference: ${r.label}` }, img(jpeg(r.file)));
  content.push({ type: "text", text: "FRAME UNDER REVIEW" }, img(jpeg(frame, 1536)));
  // Small parts (stands, arms, cables, marks) disappear in a downscaled frame: the four quarters go zoomed in too.
  for (const [q, crop] of [["top-left", "iw/2:ih/2:0:0"], ["top-right", "iw/2:ih/2:iw/2:0"], ["bottom-left", "iw/2:ih/2:0:ih/2"], ["bottom-right", "iw/2:ih/2:iw/2:ih/2"]]) {
    content.push({ type: "text", text: `Zoomed ${q} quarter of the frame under review` }, img(execFileSync("ffmpeg", ["-v", "error", "-i", frame, "-vf", `crop=${crop},scale='min(1200,iw)':-2`, "-q:v", "3", "-f", "image2", "-c:v", "mjpeg", "-"]).toString("base64")));
  }
  const items = maps.flatMap((m) => m.items.map((i) => `- ${i.name}${i.look ? ` | looks like: ${i.look}` : ""} | where: ${i.at}${i.facing ? ` | facing: ${i.facing}` : ""}${i.state ? ` | state: ${i.state}` : ""}`));
  content.push({ type: "text", text: [
    "You are a strict continuity supervisor for an animated film. Judge ONLY the frame under review, comparing it with the references.",
    maps.length ? `Fixed set map (camera: ${maps.map((m) => m.camera).join("; ")}). Every listed object must be checked:\n${items.join("\n")}` : "",
    cast.length ? `Characters (must match their sheet exactly: face, skin tone, hair, marks, clothes): ${cast.map((c) => `${c.name}: ${c.look}`).join("; ")}` : "",
    expect ? `What this frame must show: ${expect}` : "",
    "Check, object by object: present or missing; on the correct side of the picture; facing and orientation (portrait/landscape); design identical to the props or set sheet; screen state (off/on and what it shows); physically possible (one mount or base per object, no two objects sharing an arm or stand, no tangled, chain-like, broken, floating or merged parts, no impossible joints); the whole picture not mirrored compared with the anchor frame; no extra objects or people that are not described; each character identical to the sheet.",
    "Use the zoomed quarters. For every object, first write how it is held up (its base, stand, arm, joints and cables, traced from the object down to the desk) and compare that with its design on the props sheet: a stand that is tangled, twisted, chain-like, doubled, melting, missing joints, or that does not connect to the object or to the desk is a physics blocker, and a design that differs from the sheet (different arm, base, shape or color) is an object blocker.",
    "The anchor frame fixes only the layout, orientation, camera side and object designs. What screens show, whether devices are on, and the character's pose come ONLY from 'What this frame must show': never fail a screen or a pose for differing from the anchor.",
    "An object that this framing legitimately leaves out of frame or makes too small to see (a close-up that crops it, a wide exterior where the room is a small window) is ok: mark it ok with the note 'not visible at this framing'. Only judge what the framing can show.",
    "A visible, specific failure of any of these is a blocker. Minor painterly variation in color or brushwork is not a failure. When in doubt about a mount or a design, fail it.",
    'Reply with JSON only: {"pass": true|false, "objects": [{"name": "...", "mount": "how it is held up", "ok": true|false, "issue": "..."}], "characters": [{"name": "...", "ok": true|false, "issue": "..."}], "physics": [{"issue": "..."}], "mirrored": true|false, "extras": ["..."], "summary": "one sentence"}',
  ].filter(Boolean).join("\n\n") });
  const { model, json } = await judgeJSON(content, { maxTokens: 2500 });
  const fails = [
    ...(json.objects || []).filter((o) => !o.ok).map((o) => `${o.name}: ${o.issue}`),
    ...(json.characters || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.issue}`),
    // Judges sometimes list a "no problem" note under physics; only real issues count.
    ...(json.physics || []).filter((p) => p.issue && !/^\s*(no |none|n\/a)/i.test(p.issue)).map((p) => `physics: ${p.issue}`),
    ...(json.mirrored ? ["the picture is mirrored compared with the anchor frame"] : []),
    ...(json.extras || []).map((x) => `extra: ${x}`),
  ];
  return { pass: json.pass === true && !fails.length, fails, summary: json.summary || "", model };
}
