// The studio's standard character sheet: one sheet per character, never a group, the same layout
// and level of detail for every character in every vertical, drawn in the project's style: name and project, turnaround (front,
// 3/4, side, back), expressions, poses, details with callouts, color palette with hex codes, notes (role, wants, a
// secret, flaw or running bit). The whole sheet is the reference every image and video model receives.
// Why: a single sheet for a group lets the model invent strangers.
import fs from "node:fs";
import path from "node:path";

// The fields character.json needs for its sheet (sheetSpec).
export function specProblems(c) {
  const s = c.sheetSpec || {}, out = [];
  if (!s.label?.trim()) out.push("sheetSpec.label (project or series, e.g. \"ACME STUDIO\")");
  if (!(s.expressions || []).length || s.expressions.length < 4) out.push("sheetSpec.expressions (4 to 6)");
  if (!(s.poses || []).length || s.poses.length < 3) out.push("sheetSpec.poses (3)");
  if (!(s.details || []).length || s.details.length < 3) out.push("sheetSpec.details (3 details with their labels)");
  if (!((s.palette || []).length === 5 && s.palette.every((h) => /^#[0-9a-f]{6}$/i.test(h)))) out.push("sheetSpec.palette (5 hex colors)");
  if (!s.notes?.role?.trim() || !s.notes?.wants?.trim() || !(s.notes.secret || s.notes.flaw || s.notes.bit)?.trim()) out.push("sheetSpec.notes (role, wants y secret, flaw o bit)");
  return out;
}

// A look that describes more than one character is refused: one sheet, one character.
const GROUP = /\b(group of|a (?:pair|trio|team|crew|band|family) of|two|three|four|five|six|several) (?:[\w-]+ ){0,3}(people|persons|creators|workers|characters|friends|kids|children|men|women|boys|girls|siblings)\b/i;
export const isGroup = (look = "") => GROUP.test(look);

export function prompt(c, st) {
  const s = c.sheetSpec, n = s.notes;
  const third = n.secret ? ["SECRET", n.secret] : n.flaw ? ["FLAW", n.flaw] : ["RUNNING BIT", n.bit];
  return [
    `A professional character model sheet for ONE character, on a warm off-white page, laid out like a studio animation bible (landscape).`,
    `Every drawing on the sheet is rendered in this style: ${st.look}`,
    `Top left: the name "${c.name.toUpperCase()}" in large bold black sans-serif capitals; under it, smaller: "${s.label.toUpperCase()} — CHARACTER SHEET".`,
    `Left half, section "TURNAROUND": the character full body four times in a row on a thin baseline, neutral standing pose, captioned FRONT, 3/4, SIDE, BACK.`,
    `Below it, section "POSES": three full-body poses captioned ${s.poses.map((p) => `"${p.toUpperCase()}"`).join(", ")}.`,
    `Right half, top, section "EXPRESSIONS": a grid of ${s.expressions.length} head-and-shoulders close-ups captioned ${s.expressions.map((e) => `"${e.toUpperCase()}"`).join(", ")}.`,
    `Right half, middle, section "DETAILS": three close-up crops with thin callout lines and small captions: ${s.details.map((d) => `"${d.toUpperCase()}"`).join(", ")}.`,
    `Bottom left, section "COLOR PALETTE": five square swatches labelled ${s.palette.map((h) => h.toUpperCase()).join(", ")}.`,
    `Bottom right, section "NOTES" in a thin outlined box: "ROLE: ${n.role.toUpperCase()}" "WANTS: ${n.wants.toUpperCase()}" "${third[0]}: ${third[1].toUpperCase()}".`,
    `Thin gray rules under small uppercase section headings, generous white space, clean grid.`,
    `The character, identical in every drawing (same face, hair, body, clothes, colors, props): ${c.name}, ${c.look}.`,
    `Only this one character appears on the whole sheet: no other people, no animals unless the character is one.`,
    // The sheet has captions by design, so the style's "no text" rules don't apply to it.
    (() => { const neg = (st.negative || "").split(",").map((x) => x.trim()).filter((x) => x && !/text|letter|logo|watermark|word|caption|label/i.test(x)); return neg.length ? `Never: ${neg.join(", ")}.` : ""; })(),
  ].filter(Boolean).join(" ");
}

// The sheet a character's references use in a style: the standard sheet first, then the older 2x2 sheet.
export const sheetOf = (c, styleId) => c.looks?.[styleId]?.modelSheet || c.looks?.[styleId]?.sheet || null;
export const hasStandard = (c, styleId) => { const f = c.looks?.[styleId]?.modelSheet; return !!f && fs.existsSync(path.join(c.dir, f)); };
