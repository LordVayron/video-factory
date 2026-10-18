// Kie.ai client: upload, createTask, poll, download, credits, live price catalog.
//   POST https://api.kie.ai/api/v1/jobs/createTask   { model, input }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
// Every model in this factory (Veo 3.1 included) goes through the unified jobs API.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { kieKey, ROOT } from "./env.mjs";

const API = "https://api.kie.ai/api/v1";
const UPLOAD = "https://kieai.redpandaai.co/api";
const PRICING = "https://api.kie.ai/client/v1/model-pricing/page";
const CACHE_DIR = path.join(ROOT, ".cache");
const UPLOAD_CACHE = path.join(CACHE_DIR, "uploads.json");
// Kie deletes uploads after 24h; re-upload anything older than 20h.
const UPLOAD_TTL_MS = 20 * 3600 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = () => ({ Authorization: `Bearer ${kieKey()}` });

const MIME = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
  mp4: "video/mp4", mov: "video/quicktime",
};

function readCache() {
  try { return JSON.parse(fs.readFileSync(UPLOAD_CACHE, "utf8")); } catch { return {}; }
}
function writeCache(c) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(UPLOAD_CACHE, JSON.stringify(c, null, 1));
}

export async function upload(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error("file not found: " + abs);
  const buf = fs.readFileSync(abs);
  const hash = crypto.createHash("sha1").update(buf).digest("hex");
  const cache = readCache();
  const hit = cache[hash];
  if (hit && Date.now() - hit.at < UPLOAD_TTL_MS) return hit.url;

  const ext = path.extname(abs).slice(1).toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([buf], { type: MIME[ext] || "application/octet-stream" }), path.basename(abs));
  form.append("uploadPath", "factory");
  form.append("fileName", `${hash.slice(0, 10)}-${path.basename(abs)}`);
  const res = await fetch(`${UPLOAD}/file-stream-upload`, { method: "POST", headers: auth(), body: form });
  const j = await res.json().catch(() => ({}));
  const url = j?.data?.downloadUrl || j?.data?.fileUrl || j?.data?.url;
  if (!url) throw new Error("upload failed: " + JSON.stringify(j).slice(0, 300));
  cache[hash] = { url, at: Date.now(), file: path.relative(ROOT, abs) };
  writeCache(cache);
  return url;
}

// A local path becomes a hosted URL; an http(s) string passes through.
export const asUrl = (v) => (/^https?:\/\//i.test(v) ? Promise.resolve(v) : upload(v));

export async function createTask(model, input) {
  const res = await fetch(`${API}/jobs/createTask`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.code !== 200 || !j?.data?.taskId) throw new Error(`createTask ${model}: ${JSON.stringify(j).slice(0, 400)}`);
  return j.data.taskId;
}

// Pull every http(s) media URL out of a result, whatever shape the model returns.
function collectUrls(v, out = []) {
  if (typeof v === "string") {
    if (/^https?:\/\/.+\.(mp4|mov|png|jpe?g|webp|mp3|wav|m4a)(\?|$)/i.test(v)) out.push(v);
  } else if (Array.isArray(v)) v.forEach((x) => collectUrls(x, out));
  else if (v && typeof v === "object") {
    // Veo 1080p/4k put the upscaled file in result_urls and the 720p one in origin_urls.
    const keys = Object.keys(v).sort((a, b) => (a === "origin_urls") - (b === "origin_urls"));
    keys.forEach((k) => collectUrls(v[k], out));
  }
  return out;
}

export async function waitTask(taskId, { label = "job", timeoutMs = 25 * 60 * 1000, quiet = false } = {}) {
  const t0 = Date.now();
  let delay = 5000;
  let last = "";
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out (task ${taskId})`);
    const res = await fetch(`${API}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth() });
    const j = await res.json().catch(() => ({}));
    const d = j?.data || {};
    const state = String(d.state || d.status || "").toLowerCase();
    if (state === "success") {
      let out = d.resultJson;
      if (typeof out === "string") { try { out = JSON.parse(out); } catch {} }
      const urls = [...new Set(collectUrls(out))];
      if (!urls.length) throw new Error(`${label}: success but no media url: ${JSON.stringify(d).slice(0, 400)}`);
      return { urls, record: { taskId, costTime: d.costTime, creditsConsumed: d.creditsConsumed ?? d.credits } };
    }
    if (["fail", "failed", "error"].includes(state)) {
      throw new Error(`${label} failed: ${d.failMsg || d.failCode || JSON.stringify(d).slice(0, 300)}`);
    }
    if (!quiet && state !== last) {
      process.stderr.write(`  ${label}: ${state || "queued"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
      last = state;
    }
    await sleep(delay);
    delay = Math.min(delay * 1.2, 15000);
  }
}

export async function download(url, out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  fs.writeFileSync(path.resolve(out), Buffer.from(await res.arrayBuffer()));
  return out;
}

export async function credits() {
  const r = await fetch(`${API}/chat/credit`, { headers: auth() });
  const j = await r.json();
  if (j.code !== 200) throw new Error("credit check failed: " + JSON.stringify(j));
  return Number(j.data);
}

// Kie's public price list (the same feed kie.ai/pricing renders). No key needed.
export async function fetchPrices() {
  const all = [];
  for (let p = 1; p <= 30; p++) {
    const r = await fetch(PRICING, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageNum: p, pageSize: 50 }),
    });
    const rec = (await r.json())?.data?.records || [];
    all.push(...rec);
    if (rec.length < 50) break;
  }
  return all.map((r) => ({
    model: r.modelDescription, type: r.interfaceType, credits: Number(r.creditPrice),
    usd: Number(r.usdPrice), unit: r.creditUnit, official: Number(r.falPrice), page: r.anchor,
  }));
}

// Submit and wait in one call, with a single retry on transient failures.
export async function run(model, input, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const id = await createTask(model, input);
      return await waitTask(id, opts);
    } catch (e) {
      lastErr = e;
      // Only resubmit when the task never started or Kie failed it. A timeout means the first task may
      // still finish and bill, so resubmitting would pay twice.
      if (/timed out/i.test(e.message) || !/internal|busy|try again|\b5\d\d\b/i.test(e.message)) break;
      await sleep(8000);
    }
  }
  throw lastErr;
}
