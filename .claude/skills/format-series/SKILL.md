---
name: format-series
description: Produces an episode of a recurring series — 90s sitcom, comedy skit series, micro-drama / vertical novela, cartoon or anime series — with a locked cast, sets, voices and intro in series/<id>/, using pipeline v4 (writers' room script, radio cut, storyboards, Production Book with a locked budget, multi-shot scenes, continuity eval, auto edit with unified voices, series intro and outro). Use for "next episode", "otro episodio", "create a series", "crea una serie", "sitcom", "novela para TikTok", or any episode of an existing series in series/.
---

# Series episode

Read first:
- `studio.json` (the creator's profile from onboarding), if it exists.
- The vertical DNA: `sitcom-90s.md` + `sitcom-writing-bible.md` for comedy, `micro-drama.md` for vertical novelas, `anime-short.md` for anime.
- `series/<id>/series.json`: cast and ambitions, `roomMap`, voices, intro, ending, running bits, episode list. A new series starts from `series/_example/series.json`.

## New series (once)
1. With the creator: title, premise in one sentence, 3–5 characters (one want + one flaw each), 1–3 sets, tone, language.
2. Cast every character (`cast` skill): an in-style sheet per character, approved, with an ElevenLabs voice. Lock voices in `series.json → voices` (voice id, settings, seed).
3. Approve a set plate per location, with `platesMeta` (angle, time of day), and write the `roomMap` (doors, kitchen, seats, eyelines).
4. Optional intro: `node engine/series.mjs intro-assets <id>` (paid: one street shot, a theme, sounds), then `node engine/series.mjs intro <id>`.

## Each episode (the studio skill has the commands and the safeguards)
1. **Script (gate 1)**
   - Brainstorm 10 openers. The first line works with zero context and states a want.
   - Rotate the episode engine (see the DNA). No step or phase lists.
   - Comedy: 5–7+ laughs in 60 s, rule of three, a callback, a visible physical button. Micro-drama: conflict by 3 s, one power shift per scene, a cliffhanger in the last 5 s.
   - Present the script plus 2 alternative endings. Iterate until the creator approves.
2. **Shotlist**
   - Scenes of ≤15 s, each with `lighting` and `seats`.
   - Every change of place gets a shot with `moves` (shown on screen). Use `continuous: true` when a character walks into an existing frame.
   - Set `"series": "<id>"`, and for comedy `tag.sound: "outro"`, `freezeEnd: 1.6` and a big laugh on the button.
3. `radio.mjs` until pacing passes → `gen.mjs storyboard` → check every panel (identity!) → `animatic.mjs` → `book.mjs` → publish or open the book → **gate 2**.
4. `phase.mjs approve <slug> storyboard` locks the budget → `gen.mjs scenes` (all in parallel) → `continuity.mjs` → `qc.mjs score` → `edit.mjs`.
5. Watch the final (4 fps contact sheet plus the transcript) → `book.mjs` → deliver → copy into `series/<id>/episodes/` → add it to `series.json` episodes.
