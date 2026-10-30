// Join measurement: how close a take lands on the frame the next shot opens on. Measured the moment a take is
// filmed (and on every motion test), so a chain that will jump stops before the next shot is paid for, not at the
// final build when everything is spent.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const JOIN_MIN = 0.8; // SSIM at or above it reads as an invisible cut

const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-y", ...args], { encoding: "utf8" });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "join-"));

// One still of a video: its first frame or its last.
export function stillOf(video, which = "last") {
  const out = path.join(tmp(), `${which}.png`);
  ff([...(which === "last" ? ["-sseof", "-0.05"] : []), "-i", video, "-update", "1", "-frames:v", "1", out]);
  return fs.existsSync(out) ? out : null;
}

// SSIM of two pictures (stills or video frames), both scaled to the same small gray size; null when unreadable.
export function ssim(a, b) {
  if (!a || !b || !fs.existsSync(a) || !fs.existsSync(b)) return null;
  const r = ff(["-i", a, "-i", b, "-lavfi", "[0]scale=480:270,format=gray[x];[1]scale=480:270,format=gray[y];[x][y]ssim", "-f", "null", "-"]);
  const m = (r.stderr || "").match(/All:([0-9.]+)/);
  return m ? +Number(m[1]).toFixed(3) : null;
}

// Does the take end on its drawn last frame? (what the next "exact" shot opens on)
export function endMatch(video, drawnLast) {
  const v = ssim(stillOf(video, "last"), drawnLast);
  return v == null ? null : { ssim: v, min: JOIN_MIN, pass: v >= JOIN_MIN };
}

// The join as the film plays it: the previous take's last frame against this take's first frame.
export function joinMatch(prevVideo, video) {
  const v = ssim(stillOf(prevVideo, "last"), stillOf(video, "first"));
  return v == null ? null : { ssim: v, min: JOIN_MIN, pass: v >= JOIN_MIN };
}
