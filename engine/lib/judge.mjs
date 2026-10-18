// Vision judge (Claude through Kie). Shared by continuity.mjs and lib/identity.mjs.
import { kieKey } from "./env.mjs";

export const JUDGE = "claude-sonnet-5-5";

export async function judge(content, { maxTokens = 3000 } = {}) {
  const k = kieKey();
  // Kie's Claude endpoint returns transient "Internal error"s: two tries per model, a pause between.
  for (const model of [JUDGE, JUDGE, "claude-haiku-5-5", "claude-haiku-5-5"]) {
    const r = await fetch("https://api.kie.ai/claude/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": k, Authorization: `Bearer ${k}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
    });
    const j = await r.json().catch(() => ({}));
    const text = j.content?.find((c) => c.type === "text")?.text;
    if (text) return { model, text };
    console.error(`judge ${model}: ${JSON.stringify(j).slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, 6000));
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
