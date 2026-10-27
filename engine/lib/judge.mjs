// Vision judge (Claude). Shared by continuity.mjs and lib/identity.mjs.
// APIMart first (the main provider; OpenAI-style chat), Kie's Claude endpoint second.
import { env, hasApimart, hasKie } from "./env.mjs";

export const JUDGE = "claude-sonnet-5-5";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anthropic content blocks → OpenAI chat content (images as data URLs).
export const toOpenAI = (content) => content.map((c) => (c.type === "image" ? { type: "image_url", image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } } : { type: "text", text: c.text }));

async function viaApimart(model, content, maxTokens) {
  const r = await fetch("https://api.apimart.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("APIMART_API_KEY")}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, stream: false, messages: [{ role: "user", content: toOpenAI(content) }] }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j.choices?.[0]?.message?.content;
  return { text: typeof text === "string" ? text : Array.isArray(text) ? text.map((t) => t.text || "").join("") : null, j };
}

async function viaKie(model, content, maxTokens) {
  const k = env("KIE_AI_API_KEY") || env("KIE_API_TOKEN");
  const r = await fetch("https://api.kie.ai/claude/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": k, Authorization: `Bearer ${k}`, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  return { text: j.content?.find((c) => c.type === "text")?.text, j };
}

// Kie's Gemini chat endpoints (OpenAI-style, the model in the path): the fallback when Claude is down on both providers.
async function viaKieGemini(model, content, maxTokens) {
  const k = env("KIE_AI_API_KEY") || env("KIE_API_TOKEN");
  const r = await fetch(`https://api.kie.ai/${model}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, stream: false, messages: [{ role: "user", content: toOpenAI(content) }] }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j.choices?.[0]?.message?.content;
  return { text: typeof text === "string" ? text : Array.isArray(text) ? text.map((t) => t.text || "").join("") : null, j };
}

// Kie's GPT endpoint (Responses API; images as data URIs).
async function viaKieGpt(model, content, maxTokens) {
  const k = env("KIE_AI_API_KEY") || env("KIE_API_TOKEN");
  const parts = content.map((c) => (c.type === "image" ? { type: "input_image", image_url: `data:${c.source.media_type};base64,${c.source.data}` } : { type: "input_text", text: c.text }));
  const r = await fetch("https://api.kie.ai/codex/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
    body: JSON.stringify({ model, stream: false, max_output_tokens: maxTokens, input: [{ role: "user", content: parts }] }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j.output_text || (j.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("") || null;
  return { text, j };
}

export async function judge(content, { maxTokens = 3000 } = {}) {
  const tries = [];
  if (hasApimart()) tries.push(["apimart", JUDGE], ["apimart", "claude-haiku-5-5"]);
  // Kie's Claude endpoint returns transient "Internal error"s: two tries per model, a pause between.
  if (hasKie()) tries.push(["kie", JUDGE], ["kie", JUDGE], ["kie", "claude-haiku-5-5"], ["kie", "claude-haiku-5-5"], ["kie-gpt", "gpt-6-sol"], ["kie-gemini", "gemini-4-argon-openai"], ["kie-gemini", "gemini-3-8-flash-openai"]);
  for (const [via, model] of tries) {
    const { text, j } = await (via === "apimart" ? viaApimart : via === "kie-gemini" ? viaKieGemini : via === "kie-gpt" ? viaKieGpt : viaKie)(model, content, maxTokens).catch((e) => ({ j: { error: e.message } }));
    if (text) return { model: `${model} (${via})`, text };
    console.error(`judge ${model} via ${via}: ${JSON.stringify(j).slice(0, 160)}`);
    if (via === "kie") await sleep(6000);
  }
  throw new Error("no vision judge available");
}

export const parseJSON = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

// Judge and parse its JSON; a reply that is not valid JSON (cut off, chatty) is asked again once.
export async function judgeJSON(content, opts) {
  for (let i = 0; ; i++) {
    const { model, text } = await judge(content, opts);
    try { return { model, json: parseJSON(text) }; } catch (e) { if (i) throw new Error(`judge returned no valid JSON: ${e.message}`); }
  }
}
