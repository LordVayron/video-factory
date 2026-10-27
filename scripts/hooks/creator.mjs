// What the creator actually wrote, read from the session transcript, for the guard's spend rules.
// Only the creator's own messages count: typed prompts and messages sent mid-turn. Task notifications, other
// sessions, subagent reports and skill text are never the creator's words.
import fs from "node:fs";

export function creatorMessages(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const out = [];
  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "user" && e.origin?.kind === "human" && !e.isMeta) {
      const c = e.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "";
      if (text.trim()) out.push({ text, at: e.timestamp || "" });
    } else if (e.type === "attachment" && e.attachment?.type === "queued_command" && e.attachment?.origin?.kind === "human" && typeof e.attachment.prompt === "string") {
      out.push({ text: e.attachment.prompt, at: e.attachment.timestamp || e.timestamp || "" });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export const norm = (s) => String(s).normalize("NFC").toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

// A question asks for an answer, not an action: nothing is spent on it.
export function isQuestion(text) {
  const t = norm(text);
  return /[?¿]/.test(t) || /^(why|how come|what the|wtf|por ?qu[eé]|c[oó]mo es que|qu[eé] pas[oó]|explain|explica|dime (por|qu[eé]|c[oó]mo|cu[aá]nto))(?!\p{L})/u.test(t) || /(?<!\p{L})(why (the|are|is|did|do)|por ?qu[eé])(?!\p{L})/u.test(t); // data: the creator's words
}

// Words that say yes to spending or retrying. Anger or a complaint is not a yes.
// Letter boundaries, not \b: \b treats accented letters as non-word, so "sí" would never match.
export const APPROVAL = /(?<!\p{L})(s[ií]|yes|ok(ay)?|dale|sigue|contin[uú]a|continue|adelante|reintenta|retry|apruebo|aprobad[oa]|aprovad[oa]|approved?|acepto|accept(ed)?|go ahead|hazlo|do it|procede|proceed|usa|use|arranca|start|confirm[oa]?|est[aá] bien)(?!\p{L})/u; // data: the creator's words
