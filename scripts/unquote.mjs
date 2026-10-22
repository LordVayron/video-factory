// What goes into a repo says what changed, never the owner's instructions. This finds and strips
// quotes of the owner and "who said it" attributions in code comments, logs and commit messages.
// Used by publish-public.mjs (public tree), check.mjs (private sources and logs) and the guard (commit messages).
const Q = String.raw`"(?:[^"\n]|\n\s*(?:\/\/|#) ?)*?"`;
const WHO = String.raw`(?:the creator|the creator|Creador|el creador)`;
const D = String.raw`\d{4}-\d{2}-\d{2}`;

export function unquote(s) {
  return s
    .replace(new RegExp(String.raw`,\s*${WHO}:\s*${Q}`, "g"), "")                  // (date, owner: "...")
    .replace(new RegExp(String.raw`\(${WHO},?\s*(${D}):\s*${Q}\)`, "g"), "($1)")   // (owner, date: "...")
    .replace(new RegExp(String.raw`${WHO},?\s*(${D}):\s*${Q}`, "g"), "$1")         // owner, date: "..."
    .replace(new RegExp(String.raw`${WHO}:\s*${Q}`, "g"), "")                       // 
    .replace(new RegExp(String.raw`\((${D}):\s*${Q}\)`, "g"), "($1)")               // (date: "...")
    .replace(new RegExp(String.raw`\(${WHO},\s*(${D})\)`, "g"), "($1)")             // (owner, date)
    .replace(new RegExp(String.raw`\(${WHO},\s*(${D})`, "g"), "($1")                // (owner, date: why...)
    .replace(new RegExp(String.raw`\b${WHO} (${D}):`, "g"), "$1:");                 // owner date: ...
}

// Commit subjects and PR titles in the factory's repos follow Conventional Commits: a type, an optional scope, a short
// summary. A PR title stays shorter because the squash merge appends " (#123)".
export const TYPES = ["feat", "fix", "docs", "refactor", "perf", "test", "ci", "chore", "release"];
export function subjectProblems(subject, { max = 72 } = {}) {
  const s = String(subject || "").trim(), out = [];
  if (!new RegExp(String.raw`^(${TYPES.join("|")})(\([a-z0-9-]+\))?!?: \S`).test(s)) out.push(`start with a type and a colon (${TYPES.join(", ")}), e.g. "fix: keep the pauses on a re-cut"`);
  if (s.length > max) out.push(`${s.length} characters; keep it under ${max}`);
  return out;
}

// A commit message or log entry that carries instructions: the owner's name, or a quoted passage of 3+ words.
export function carriesInstructions(text) {
  const out = [];
  if (/\bthe creator\b|\bCreador\b|\bel creador dijo\b/i.test(text)) out.push("names the owner");
  const q = (text.match(/"[^"\n]{12,}"/g) || []).filter((x) => x.trim().split(/\s+/).length >= 3);
  if (q.length) out.push(`quotes: ${q.slice(0, 2).join(" ")}`);
  return out;
}
