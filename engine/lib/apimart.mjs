// APIMart client (the studio's main provider; Kie is the second one).
//   POST https://api.apimart.ai/v1/videos/generations | /v1/images/generations   → { data: [{ task_id }] }
//   GET  https://api.apimart.ai/v1/tasks/{task_id}                              → { data: { status, cost, result } }
//   POST https://api.apimart.ai/v1/uploads/images (multipart "file")            → { url }   (kept 72 h)
//   GET  https://api.apimart.ai/api/pricing/model?model=<id>   public price of one model, no key
//   GET  https://api.apimart.ai/v1/balance                     remaining USD of the key
// Prices and costs are in USD; the engine converts them to its budget unit (1 credit = $0.005).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { apimartKey, ROOT } from "./env.mjs";

const API = "https://api.apimart.ai";
const CACHE_DIR = path.join(ROOT, ".cache");
const UPLOAD_CACHE = path.join(CACHE_DIR, "uploads-apimart.json");
const UPLOAD_TTL_MS = 60 * 3600 * 1000; // APIMart keeps uploads 72 h; re-upload after 60 h
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const auth = () => ({ Authorization: `Bearer ${apimartKey()}` });
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

const errText = (j) => j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);

export async function upload(file) {
  const abs = path.resolve(file);
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (!MIME[ext]) throw new Error(`APIMart hosts images only (${path.basename(abs)})`);
  const buf = fs.readFileSync(abs);
  const hash = crypto.createHash("sha1").update(buf).digest("hex");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(UPLOAD_CACHE, "utf8")); } catch {}
  if (cache[hash] && Date.now() - cache[hash].at < UPLOAD_TTL_MS) return cache[hash].url;
  const form = new FormData();
  form.append("file", new Blob([buf], { type: MIME[ext] }), path.basename(abs));
  const r = await fetch(`${API}/v1/uploads/images`, { method: "POST", headers: auth(), body: form });
  const j = await r.json().catch(() => ({}));
  const url = j.url || j.data?.url;
  if (!url) throw new Error(`APIMart upload: ${errText(j)}`);
  cache[hash] = { url, at: Date.now(), file: path.relative(ROOT, abs) };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(UPLOAD_CACHE, JSON.stringify(cache, null, 1));
  return url;
}

// kind: "videos" | "images". Returns the task id; throws when no task was created (nothing billed).
export async function createTask(kind, body) {
  const r = await fetch(`${API}/v1/${kind}/generations`, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const id = j?.data?.[0]?.task_id || j?.data?.task_id || j?.task_id;
  if (!id) throw new Error(`APIMart ${body.model}: ${errText(j)}`);
  return id;
}

// Every http(s) URL in a result (APIMart returns { videos: [{ url: [..] }] } or { images: [...] }).
export function collectUrls(v, out = []) {
  if (typeof v === "string") { if (/^https?:\/\//i.test(v)) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => collectUrls(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!/thumb|cover|poster|last_frame/i.test(k)) collectUrls(x, out);
  return out;
}

export async function waitTask(taskId, { label = "job", timeoutMs = 25 * 60 * 1000, quiet = false } = {}) {
  const t0 = Date.now();
  let delay = 5000, last = "";
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: timed out (APIMart task ${taskId})`);
    const r = await fetch(`${API}/v1/tasks/${encodeURIComponent(taskId)}?language=en`, { headers: auth() });
    const j = await r.json().catch(() => ({}));
    const d = j?.data || {};
    const state = String(d.status || "").toLowerCase();
    if (state === "completed") {
      const urls = [...new Set(collectUrls(d.result))];
      if (!urls.length) throw new Error(`${label}: completed but no media url: ${JSON.stringify(d).slice(0, 300)}`);
      return { urls, record: { taskId, usd: Number.isFinite(+d.cost) ? +d.cost : null, seconds: d.actual_time } };
    }
    if (["failed", "cancelled", "error"].includes(state)) throw new Error(`${label} failed: ${d.error?.message || errText(d)}`);
    if (!quiet && state !== last) { process.stderr.write(`  ${label}: ${state || "queued"} (${Math.round((Date.now() - t0) / 1000)}s, APIMart)\n`); last = state; }
    await sleep(delay);
    delay = Math.min(delay * 1.2, 15000);
  }
}

export async function balance() {
  const r = await fetch(`${API}/v1/balance`, { headers: auth() });
  const j = await r.json().catch(() => ({}));
  if (j.success === false || j.error) throw new Error(`APIMart balance: ${errText(j)}`);
  return Number(j.remain_balance ?? j.data?.remain_balance);
}

// Public price of one model (no key). Keeps only what the engine prices with.
export async function fetchPrice(model) {
  const r = await fetch(`${API}/api/pricing/model?model=${encodeURIComponent(model)}`);
  const d = (await r.json().catch(() => ({})))?.data;
  if (!d) throw new Error(`no APIMart price for ${model}`);
  const pick = ["billing_type", "paid_price", "model_price", "resolution_paid_prices", "billing_tier_paid_prices"];
  const out = Object.fromEntries(pick.filter((k) => d[k] != null).map((k) => [k, d[k]]));
  const sq = d.precharge_prices?.size_quality_prices;
  if (sq) out.size_quality_prices = sq;
  return out;
}
