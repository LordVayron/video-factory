// Key loading: the factory's .env, then real environment variables (which win).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const CANDIDATES = [path.join(ROOT, ".env")];

function parse(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

let cache;
function all() {
  if (cache) return cache;
  cache = {};
  for (const f of [...CANDIDATES].reverse()) if (fs.existsSync(f)) Object.assign(cache, parse(f));
  Object.assign(cache, process.env);
  return cache;
}

export function env(name, fallback) {
  return all()[name] ?? fallback;
}

export function kieKey() {
  const k = env("KIE_AI_API_KEY") || env("KIE_API_TOKEN");
  if (!k) throw new Error("No Kie key. Put KIE_API_TOKEN=... in " + CANDIDATES[0]);
  return k;
}

export function elevenKey() {
  return env("ELEVENLABS_API_KEY");
}

// APIMart: the main provider; Kie stays as the second one. Either key alone is enough.
export function apimartKey() {
  const k = env("APIMART_API_KEY");
  if (!k) throw new Error("No APIMart key. Put APIMART_API_KEY=... in " + CANDIDATES[0]);
  return k;
}
export const hasApimart = () => !!(process.env.APIMART_API_KEY || env("APIMART_API_KEY"));
export const hasKie = () => !!(process.env.KIE_API_TOKEN || process.env.KIE_AI_API_KEY || env("KIE_AI_API_KEY") || env("KIE_API_TOKEN"));
