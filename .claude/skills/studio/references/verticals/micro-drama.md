# Vertical DNA: micro-drama (vertical "novela" series for TikTok, Reels and Shorts)

Serialized melodrama in short vertical episodes: secret identities, betrayal, revenge, forbidden love. **Conflict on screen in the first seconds, one power shift per scene, and an ending that cuts at maximum unresolved tension.** Rewritten 2026-10-19 from AI micro-drama production research and from two rejected episodes of ours (The Secret Heiress, The Toast). The engine enforces the hard rules (`lib/flow.mjs` dramaRules, the pilot gate, the format check); this file is how to write and plan inside them.

## What the format is

- **Length:** live-action catalogues run 60–120 s; AI series run best at **45–75 s** (fewer generations, less drift).
- **Structure** (75 s reference; scale it down for shorter): hook 0–15 s → escalation 15–60 s → spike 60–80 s → button 80–90 s. Turn the story about every 30 s.
- **Hook:** open on conflict already visible: no establishing shot, no walking in, no sitting down. The first frame must read with the sound off.
- **Button / cliffhanger:** cut at maximum unresolved tension, 2–4 s before the "comfortable" moment. Four kinds: partial revelation, reversal setup, intrusion, deadline. Rotate identity / emotion / realization hooks across episodes.
- **Scenes:** 2–4 per episode, one or two locations. Every scene has exactly one power shift (X has power, Y takes it).
- **Dialogue:** 180–360 words per 90 s at ~3 words/second. Short, quotable, spoken. One line under ~20 words; under two sentences per shot. Cut dialogue that explains what the viewer already knows.
- **Logic check:** every line must make sense once the twist is known (The Toast: the fiancé said "Grace, I can explain" to the bride who had paid him; it contradicted the ending). Read the script backwards from the twist before approving it.

## What today's video models can and can't do (enforced)

| Works | Fails (blocked or flagged by the engine) |
|---|---|
| Two-person close-ups, shot / reverse shot, single emotional beats | More than 2 people in one shot |
| One action per shot, eye-level camera, slow push-ins | Compound actions, extreme angles (identity drifts) |
| Objects already in hand | Hand-object work: placing, picking up, tearing, signing, pouring, tapping a glass |
| Motion implied by cuts | Running, slapping, falling, door slams, fights |
| Bright natural light: daylight, window light, bright practical interiors | Night, candlelight, neon, low key: it reads "AI" and "shady" (the creator). Allowed only with `sl.lowLightOk` in the creator's words |
| 2–3 shots per generation, 10–15 s | 4+ shots per generation; quality degrades after ~15–30 s |
| Lines that fit the shot (~3 words/s: 3 s = 4–6 words, 5 s = 8–12) | Long monologues: lip sync breaks |

## Production recipe

1. **Script** as scenes of 2–3 shots, each shot: framing, one action, one line in quotes with its tone. Nothing in it the table above calls a failure.
2. **Cast:** each lead gets a neutral-pose sheet (front, three-quarter, profile, full body) in the episode's light, plus a designed voice. Write a **constraint card** per character (age, hair, wardrobe colour, marks): the same words go into every prompt.
3. **Set:** one plate per location, **lit bright and natural**, and one **lighting line** pasted verbatim into every scene of that location (e.g. "soft overcast daylight from the tall window on the left, neutral white balance").
4. **Look test first (cents):** one still of the leads in the set at the episode's light. If it doesn't read as a real photo to the creator, nothing else gets made.
5. **Model:** dialogue scenes on a model with native lip sync and character references in one multi-shot pass (Seedance 2 family with the sheets and the voice samples as references). One shot per generation (Kling, Veo first-frame) only for single-character inserts: every separate generation re-invents the voice and the light.
6. **Prompt template per scene** (the engine builds it: `P.scenePrompt`, with a JSON spec per shot):
   `[character constraint cards] [location + lighting line] Shot 1 [0–4s]: framing, camera, one action. NAME (tone): "line". Shot 2 [4–8s]: … Audio: room tone, no music. Must not: …`
   Name the light source and its side, a 35 mm or 50 mm lens, eye level, natural skin texture; spend words on verbs and concrete details, never on "cinematic, stunning, 8k".
7. **Pilot:** the first scene only (the engine allows nothing else until the creator approves it), edited with score and stings, judged on a phone.
8. **Edit:** hard cuts only; trim the wobbly first and last fraction of each generation; hold a reaction to its peak, never past it; ambient room tone under every line; a score bed ducked under dialogue, a sting on each power shift landing on the punchline, a swell into the final freeze; captions large, in the safe zone, timed on the final track. Keep the take's own voice (the one in sync with the lips); a re-voice only if the lip-sync check passes.

## Cost guide (Kie live prices, 2026-10-19)

| Model (720p) | ~45 s episode | Notes |
|---|---|---|
| Seedance 2.0 Mini | ~$1.85 | cheapest multi-shot; check realism in the look test |
| Wan 3.0 | ~$3.60 | rushed speech in our tests |
| Kling 3.0 (per shot) | ~$4.50 | invents cuts and gestures; voice changes shot to shot |
| Seedance 2.0 Fast | ~$5.60 | |
| Seedance 2.0 | ~$9.20 | strong identity with references |
| Seedance 2.5 | ~$14 | our best realism (The Glow Up) |
Add ~$0.50 for sheets, plate, look test, boards and score. A realistic, cheap episode means **short (30–45 s), few generations, bright light, one location**.

## Pacing QC

| Metric | Pass |
|---|---|
| Conflict on screen by | 3 s |
| Cuts | every 2–4 s in the hook, 1–2 s at the spike |
| Delivery | 130–165 wpm (median per line) |
| Reactions | held to the peak (≤ 2 s), one per power shift |
| Ending | cut at maximum tension, held face + freeze + sting |
| Captions | on, synced to the final track |
| Lip sync | every word within 0.2 s of the mouth |

## Lessons that cost money

- **The Secret Heiress (2026-10-19, $10.31, rejected):** six scenes filmed at once on an untested model; wardrobe drifted because scenes only sent face crops; the editor had no score; night foyer. Gates added: pilot, format readiness, full-body references.
- **The Toast (2026-10-19, $5.98, rejected):** candlelit night (dark, orange, "AI"); 3 characters in shots; hand-object beats (ring, glass); Kling per-shot invented a gesture and a cut; re-voice drifted 1 s from the lips; a line that contradicted the twist. Rules added: dramaRules (light, people per shot, hands, motion, words per second), lip-sync check, native voices by default, logic check.
