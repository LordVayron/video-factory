---
name: format-longform
description: Produces long-form ambient videos (10 minutes to 3 hours) — guided meditation, sleep stories, breathwork, affirmations, yoga nidra, focus/study music, ambient loops — with seamless looping AI scenes, a Suno music bed and an optional ElevenLabs voice-over with long pauses, delivered as 1080p YouTube video plus MP3. Use for "meditación", "meditation video", "sleep story", "música para dormir", "ambient loop", "focus music", "video largo de relajación", "yoga nidra", "affirmations".
---

# Long-form ambient video

Read first: `.claude/skills/studio/references/verticals/meditation-longform.md` (the DNA: voice pace, pause lengths, arcs, music rules, QC). The studio skill's money rules apply: estimate first, gate before spending, never spend past the locked budget.

## Steps
1. **Brief:** the format (from the DNA table), length, language, intention ("fall asleep", "calm before an exam"), voice gender and character, music mood, visual world (forest, ocean, cosmos, candle-lit room...). For voice-free ambient, skip everything about the script.
2. **Plan (gate 1):** the intake creates the project: `node engine/studio.mjs new <slug> --format meditation --seconds <length in seconds> ...` (studio skill). Then fill the `longform` block, and follow `studio.mjs status <slug>`:
   - `script[]` with `pauseAfter` per segment, written to the DNA's density for the length.
   - 3–6 `scenes` with matching `look`; use `"kenburns"` for scenes where motion would distract (paintings, interiors) or to save cost.
   - `music.prompt` and `voice.eleven` (pick a calm voice; list voices with the ElevenLabs API or ask the creator).
   Present the script, the scene list, the music prompt and the estimated runtime. Iterate until approved.
3. **Production Book (gate 2):** `node engine/longform.mjs estimate <slug>` → `node engine/book.mjs <slug>` → show it → after the creator's yes `node engine/studio.mjs approve <slug> book --said "..."` (locks the budget).
4. **Voice first:** `node engine/gen.mjs narration <slug>`. Listen to the first two segments (pace, warmth). If the voice is wrong, change it now.
5. **Music and picture:** `node engine/gen.mjs bed <slug>` and `node engine/gen.mjs loops <slug>`.
6. **Preview:** `node engine/longform.mjs build <slug> --sample 90` and check the balance of voice and music and the first cross-fade.
7. **Final:** `node engine/longform.mjs build <slug>` → mp4 + mp3 + contact sheet + QC → `node engine/studio.mjs qc <slug>`. Look at the sheet; spot-check the voice at 3 points.
8. **Deliver:** `node engine/studio.mjs deliver <slug>` (receipt + final book), then the files, a title, a description with chapters from `longform.cues`, and a thumbnail (the best still, 1280×720).
