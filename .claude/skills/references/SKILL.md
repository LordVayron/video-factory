---
name: references
description: The reference engine of the AI Video Factory. Use whenever the creator shares videos or links they like as references ("aquí te dejo estos videos de UGC", "mira este video", "analiza este TikTok/Reel/YouTube", "quiero algo como esto", a pasted video link or an attached .mp4, "reference", "referencia", "breakdown", "desglose", "reverse engineer this video"), or asks what is in the reference bank. Measures every video locally, writes a frame-by-frame breakdown (hook, script, structure, every shot and join, voice, music, effects, on-screen text, look), asks only what it can't tell, publishes the breakdown page and adds it to the bank in the creator's words. The creator never types a command.
---

# References: the creator gives videos, Claude does the rest

The creator talks; Claude runs `engine/refs.mjs`. Never ask the creator to type a command or remember an id. Everything in this skill is enforced in code (`engine/lib/refs.mjs`, `scripts/check-refs.mjs`); the steps below are how to drive it.

## 1. Take every video in
- A file (attached or a path): `node engine/refs.mjs add "<path>" --note "<short name you choose>" [--lang es]`.
- A link (TikTok, Instagram, YouTube, X, any page yt-dlp reads): the same command with the link. Only links the creator gave; say what was downloaded (title, platform, length). If a link fails, say why in one line and ask for the file instead.
- Several at once: run `add` for each. The note is a short readable name ("ugc-skincare-mirror"), never the creator's typing.

`add` measures on its own: transcript word by word (never silence detection), cuts and every shot's length and motion, the hook (first 3 s), pauses, the bed under the voice, the mix, the music's tempo, sound hits outside the voice, on-screen text (local OCR), brightness and color, and a format guess with its confidence. It cuts `refs/<id>/sheets/`: `overview.jpg`, `shot-NN.jpg` (4 fps) and `join-NN.jpg` (the half second on each side of every cut).

## 2. Look at everything, then write the breakdown
Read `overview.jpg`, **every** `shot-NN.jpg` and **every** `join-NN.jpg` with the Read tool. Use `refs.mjs show <id>` for the numbers. Then write `breakdown.json` (contract: `Breakdown` in `engine/lib/refs.mjs`):
- `format` and why; `summary`;
- `hook`: type, seconds, the words, why it works;
- `structure`: beats with times;
- `shots`: one entry per measured shot (what, framing, camera, action) and for every shot but the last `transitionOut` {type, how it joins the next};
- `voice` (who, delivery), `music` (present, style, role), `sfx` (times and what), `onScreenText` (style, examples), `look`;
- `takeaways` (what we learn, at least 3) and `neverCopy` (characters, lines, logos, signature compositions).

Save it with `node engine/refs.mjs breakdown <id> --file <json>`. `breakdownRules` refuses a missing shot or join, beats outside the video, music that contradicts the measurement, measured on-screen text with no style described, or measured sound hits with no effects listed. Fix and save again; never weaken the breakdown to pass.

## 3. Ask only what you can't tell
When the measured guess is under 70 % or disagrees with what you saw (UGC vs influencer is the usual one), ask one question with buttons (AskUserQuestion), for example "¿La guardo como referencia de UGC o de influencer?". Also ask what they liked if it isn't obvious (hook, rhythm, look, all of it) and put it in the takeaways.

## 4. Show the page, approve in their words
`node engine/refs.mjs page <id>`, then publish `refs/<id>/page.html` with the Artifact tool, sending the sheets as files (`root: refs/<id>`, `files: ["sheets/overview.jpg", "sheets/shot-01.jpg", ...]`). Give the link. On their approval: `node engine/refs.mjs approve <id> --said "<their exact words>"` (and `--format-said "<their words>"` when the format was their call). Never approve with words they didn't say, never as a test.

## 5. In production
`studio.mjs new` lists the approved references of the format. Offer them with buttons; record the choice with `node engine/studio.mjs refs <slug> --use id,id --said "..."` or `--none --said "..."`. The concept gate waits for it; a launch plan is calibrated to the chosen references; the script gate refuses lines that repeat a reference's phrases (`copyOverlap` over 20 %). Use the bank's ranges (`refs.mjs bank --format <f>`) and takeaways when writing; never copy a reference's characters, lines, logos or signature shots.

## What stays private
Reference media (`refs/**/source.*`, `refs/**/sheets/`) is ignored by git; profiles, breakdowns and pages are kept. The public edition ships the engine, never the bank.
