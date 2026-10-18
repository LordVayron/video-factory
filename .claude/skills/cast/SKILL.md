---
name: cast
description: Creates and maintains the reusable bible of characters, sets and styles (bible/), including character sheets, voice choice and voice samples, and the "clone me" / AI-influencer intake from the user's own photos and voice. Use when a story needs a character or location that doesn't exist yet, when a character drifts between shots, or when the user says "clone me", "make an AI influencer", "new character", "crea un personaje".
---

# Cast and bible

Everything here is reused across projects, so it is worth getting right once.

## Character (`bible/characters/<id>/`)
`character.json` fields: `id`, `name`, `species`, `look` (one dense sentence: body, face, hair/fur, wardrobe, one signature accessory, **and every distinctive mark by name: freckles, moles, scars, glasses, earrings**. The prompt check refuses any video prompt that drops one, and the identity eval checks each of them on every take), `traits`, `flaw`, `role` (straight man / eccentric / …), `voiceDesc`, `voice`, `sheets`.

1. **Sheet:** one 3:2, 2K image showing front, ¾ and full body on a plain backdrop.
   `node engine/gen.mjs still "<sheet prompt>" bible/characters/<id>/sheet.png --ar 3:2 --size 2K`
   Template: "Character reference sheet on a plain warm cream (#F2E8D5) studio backdrop, photoreal, 35mm film look, soft even key light. The same character shown three times side by side: (1) front view, (2) three-quarter view, (3) full body. Character: <look>. Identical wardrobe and markings in all three views. No text, no labels."
   Look at the result yourself. Reroll for wrong anatomy, mismatched views, text. Crop with ffmpeg rather than paying for a reroll when one view is bad.
2. **Voice:**
   - `voice.id`: an ElevenLabs preset that Kie serves (list in `engine/voices.txt`, preview at `https://static.aiquickdraw.com/elevenlabs/voice/<id>.mp3`). Optional per-language overrides `voice.en`/`voice.es`.
   - `voice.eleven`: a voice on the user's own ElevenLabs account, used when Kie's endpoint fails. Free plans can only use premade voices: onwK4e9ZLuTAKqWW03F9 (Daniel, British), TX3LPaxmHKxFdv7VOQHJ (Liam, young), JBFqnCBsd6RMkjVDRZzb (George, warm British), EXAVITQu4vr4xnSDxMaL (Sarah), pNInz6obpgDQGcFmaJgB (Adam).
   - `voice.sampleText.{en,es}`: about 8s of in-character speech.
   - `node engine/gen.mjs sample <id> --lang en` writes `voice-en.mp3`. Seedance uses it as `@audioN` so the voice stays the same in every shot.
3. Add one running gag or catchphrase to `traits`.
4. **Approval (flow v5 cast gate):** show the creator the sheet, the look and a voice sample; with their yes, `node engine/studio.mjs approve-character <id> --said "<their words>"` (or `cast.mjs approve` for in-style sheets). Lock the face anchor from their approved take with `continuity.mjs <slug> --identity <take> --lock-anchor`.

## Realistic styles: native references (the rule that fixed the "sticker" look)
Image models **composite** a studio reference photo into the scene, keeping its pose and its lighting, so the character looks pasted in. For any realistic style:
1. Make the empty set plate first.
2. Generate each character **inside the set from text only** (only the set plate as a ref), with Nano Banana Pro at 2K: "a frame grab ... a real, normal-sized <animal/person> ... lit by the same light as the room, soft shadow on the floor, same video texture ... not composited". Clothing must be described as real garments that fit imperfectly ("loose, bunches at the shoulders").
3. Crop the character out of that frame → `ref-native.png`, set `"refs": ["ref-native.png"]`. The studio `sheet.png` stays only as a design reference; never feed it to shots.
4. Use realistic scale words ("normal-sized house cat, small next to the furniture") and natural animal posture.
A realistic character works best with a native reference (`bible/characters/<id>/ref-native.png`) in addition to the in-style sheet.

## Set (`bible/sets/<id>/set.json`)
`look` (one dense sentence), `plates` (a wide 9:16 empty plate at minimum), `geography` (where things are, and who stands on which side of frame).
`node engine/gen.mjs still "<style string> wide establishing shot, empty of characters. <look>. No text, no people." bible/sets/<id>/plate-wide.png --size 2K`

## In-style character sheets (phase 3, the current method)
`node engine/cast.mjs sheet <char> --style <style> --set <set>` makes a 2x2 sheet in the style (realistic styles: shot inside the set plate), splits it into `front`, `threeQuarter`, `profile` and `full` views under `bible/characters/<char>/<style>/`, and records them in `character.json → looks.<style>`. Review it and score: `cast.mjs approve <char> --style <style> consistency=N anatomy=N design=N style=N layout=N`. Rejected sheets: regenerate with `--note "<fix>"`. Shots then get only the views their framing needs.

## Styles
Style sheets live in `bible/styles/<id>/style.json` and are managed with `engine/style.mjs` (see the studio skill and `studio/references/styles.md`).

## Clone me / AI influencer
Only for the user's own likeness, or a fictional person. Never clone a real third party.
1. Ask the user for 6–12 photos of themselves (front, ¾, profile, two outfits, good light) dropped in `bible/characters/<id>/photos/`, plus 1–2 minutes of clean speech in `voice-source.mp3`.
2. Build the sheet with Nano Banana from the photos as refs (`--ref` each photo, up to 10): "Character reference sheet of this exact person…".
3. Voice: instant voice cloning needs an ElevenLabs paid plan (Starter). Clone in the ElevenLabs UI, then put the new voice id in `voice.eleven` with `"provider": "elevenlabs"`. Until then, pick the closest preset.
4. For talking-head content, `node engine/gen.mjs talk <photo-or-keyframe> <line.mp3> out.mp4 --model infinitetalk` ($0.015/s at 480p). For scenes, use the character in a normal shot list.
