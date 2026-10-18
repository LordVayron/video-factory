# Cinematography and prompt craft for AI video

## The six things every shot specifies
1. **Framing:** extreme wide · wide · full · medium · medium close-up (MCU) · close-up (CU) · extreme close-up (ECU) · over-the-shoulder (OTS) · two-shot · insert.
2. **Lens:** 24–28mm (wide, space, comedy physicality) · 35mm (natural, documentary) · 50mm (dialogue singles) · 85mm (portrait, reactions, shallow depth of field) · 100mm macro (product detail).
3. **Light:** source + direction + color temperature. "3200K tungsten key from camera left, soft fill, warm rim from behind." Name the motivation (window, lamp, neon sign). For a sitcom: high-key, even, warm. For drama: low-key, one hard source, contrast.
4. **Camera move + speed:** locked off · slow push-in (tension, realization) · pull-out (reveal, isolation) · pan / tilt · tracking/dolly alongside · orbit (product, hero) · crane up (ending, scale) · handheld (UGC, urgency) · whip-pan (comic transition) · snap zoom (comedy beat).
5. **Subject action:** one verb chain per shot. Use physics words: "ears flatten", "tail sweeps the mug off the desk", "coffee splashes across the keys", "hair whips in the wind".
6. **Palette:** 3–4 HEX colors held across the whole piece (in `bible/styles/*.json`).

## Grammar that keeps AI edits watchable
- **180° rule:** a character keeps their screen side for the whole scene (the cat left, the dog right). Say "facing frame right" in the image prompt.
- **Eyelines:** in singles, the speaker looks toward where the other character is ("looking off-screen right").
- **Cut on action:** end shot A mid-gesture and start shot B continuing it. Prompt the motion to *start* already moving.
- **Shot size steps:** don't cut between two similar sizes of the same subject (a jump cut). Wide → MCU → CU reads; MCU → MCU of the same person doesn't.
- **J and L cuts:** let the next line start over the current reaction (assembled in the edit).
- **Hold the reaction:** comedy lives in the 0.5–1s after the line. Leave it in the shot (`trim` can cut it later).

## Prompt formulas

### Keyframe (Nano Banana 2.1 via `frames`)
`[style string] + [framing, lens] + [who, where in frame, pose, expression, props] + [character look text] + [set] + "Vertical 9:16. No text."`
The engine assembles everything except the middle part, which is your `image` field. Rules:
- Describe one frozen instant, not a sequence.
- Name positions (frame left / center / frame right, foreground / background).
- Put props in hands or on surfaces explicitly.
- The reference sheets do the identity work. Don't redescribe faces in different words from the bible.

### Motion (video models via `video`)
`[opening frame instruction] + Camera: [move, speed] + [action, physics] + Dialogue: Name (voice), delivery: "line" + Sound: [sfx] + [style motion line] + consistency clause`
Your `motion` field is the action part. Rules:
- One main action and one reaction. Two characters doing complex things at once breaks models.
- Say what *doesn't* move when it matters: "The cat stays perfectly still."
- For a talking shot, the action is small: "leans in, raises a paw". Big body motion plus lip-sync looks bad.
- Timing words help: "after a beat", "slowly", "suddenly".

### Seedance 2 specifics (default model family)
- Three exclusive modes: first/last frame · multimodal references · text-only. The engine uses **reference mode** when there are character sheets or voice samples: the approved keyframe becomes `@image1`, and the sheets follow.
- Voice samples go in as `@audio1..3` and the prompt says "Name (voice of @audio1)". That keeps a character's voice consistent across shots.
- Set `strictFrame: true` on a shot when the first frame must match the keyframe exactly (inserts, product shots). This drops the refs and voice refs.
- Duration 4–15s. Billing is per second, so don't pad.

### Veo 3.1 (Lite/Fast/Quality)
- Durations 4/6/8 only. First+last frame mode or up to 3 reference images (8s only, Lite/Fast).
- Speaks the dialogue written in the prompt well; no voice reference, so voices drift between shots. Best for single-character shots and one-offs.

### Kling 3.0
- Best for start→end frame transitions (`lastFrame`), product orbits, and multi-shot sequences (up to 5 shots in one call, 15s).
- `kling_elements` lock up to 3 characters with 2–4 images each. Not wired into the engine yet; add it if Seedance consistency fails.

### Grok Imagine
- Cheapest motion ($0.012/s at 480p) and it always generates audio. Duration 6–30s. Up to 7 reference images (`@image1`…). Good for drafts and B-roll.

## Realism playbook (why early tests looked fake; what fixed it)
Lessons from the 2026-10-08 look test against "Bad Cat":
1. **Imitate a medium, not "photorealism".** "A still frame from a 1990s network sitcom, recorded off-air from TV" beats "photoreal 35mm". The SD softness and flat TV light hide AI tells; glossy "photoreal" exposes them.
2. **Stage like the real thing.** Sitcom distance (medium-wide, eye level, long lens), ordinary furniture, lived-in props, muted walls. An art-directed, over-cluttered set reads as an AI render.
3. **Put a human in the scene.** A real-looking co-star sells the world. Write an original person (hair, freckles, wardrobe); never name a real show or actor.
4. **The animal behaves like an animal.** Costume is the joke; posture and movement stay cat/dog (sits on a chair, ear flicks, slow blinks). Avoid human hand poses like typing.
5. **References carry their rendering look.** A glossy studio sheet or set plate drags the frame back to glossy. Use single-view refs (`ref.png`), and skip the set plate as a ref for realistic styles (`setRef: false`).
6. **Image model matters most for realism.** Nano Banana Pro ($0.09) made convincing frame grabs where 2.1 made a collage. Spend on the keyframe, then keep video cheap.
7. **Resolution:** final clips at 720p minimum; 480p upscaled looks mushy.

8. **Native references, not studio sheets** (2026-10-08, second test). Characters made from a studio photo look pasted in: wrong light, too crisp, wrong scale. Characters generated *inside* the set from text read as real. See the cast skill.
9. **Realism tier settings:** keyframes `nbpro` at `imageSize: "2K"`; video `wan3-prime` (or `kling3` pro) at 1080p; `"finish": "broadcast"` on the project, a shared grade that glues every shot into one picture. The budget tier (`nb2.1` 1K + `wan3` 720p) is for drafts only.

## Look recipes
- **90s sitcom:** high-key tungsten 3200K, 28–50mm, locked-off multi-cam angles, warm saturated palette, film grain.
- **UGC phone:** handheld, slight wobble, 26mm phone lens, window daylight 5600K, auto-exposure feel, vertical, mixed room light.
- **Premium product:** 100mm macro, black or seamless backdrop, hard rim + soft top light, slow orbit or push-in, condensation/particles.
- **Cinematic drama:** anamorphic 40mm, teal-and-amber grade, haze, one motivated hard key, slow dolly.
