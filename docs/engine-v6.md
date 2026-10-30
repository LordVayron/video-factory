# Engine v6: the sequence-first director

v5 generated a film one short shot at a time and glued the shots together. Each shot was a separate generation that
started on a drawn frame, so every cut depended on a video model landing exactly on a planned pose. Models don't, and
the cuts jumped. Every rule added on top of that unit (chains, copies, joins measured at the build) treated the
symptom.

v6 changes the unit. The engine generates **sequences**: a whole scene of up to the model's longest clip, with its
cuts designed in the prompt (shot by shot: size, angle, move, action, timing), the character and set references, and
one opening keyframe. The model makes the cuts inside one generation, with the same people, light and set on both
sides of each cut. Films are sequences joined at real scene changes (another place, another moment), where a hard cut
is what an editor would make.

The research behind it:
- End-to-end studios decide the camera language before generating: genre, size, lens, angle, move and emotion per
  shot (Higgsfield Cinema Studio).
- Agentic film pipelines split a script into generation segments at cinematographic boundaries, never inside a
  complex camera move, and chain segments by the real last frame of the previous one (DirectorAgent, arXiv 2601.17737).
- Current video models (Seedance 2.x, Wan 3.0, Kling 3 multi-shot) render several shots with cuts in one call and keep
  characters consistent across them when they get reference images; across separate calls consistency comes from
  references, not from drawn frames.
- Keep the change between two anchors small; big jumps in framing or light inside one generation break it.

## The pipeline (every vertical)

| Stage | What happens | Who decides |
|---|---|---|
| 1. Intake | Up to 7 questions for the vertical. The brand memory (choices and rejections for this brand) loads with it. | Creator answers |
| 2. Treatment | Concept and script, written to the vertical's writing rules. | **Creator gate 1** |
| 3. Direction | `lib/direction.mjs`: the script becomes scenes, each scene becomes one or more sequences that fit the model, each sequence a shot list with sizes, angles, moves and timing. Film grammar is enforced here (a cut changes size or angle; no cut inside a move; shot-length bands per vertical; size variety). | Engine |
| 4. Look | Style, one character sheet per character, set sheets (existing). | Creator approves the look |
| 5. Keyframes | One opening keyframe per sequence (not per shot), judged against the sheets and the set map. | Engine |
| 6. Model test | The chosen model renders the hardest sequence once: cuts at the planned times, the same faces across cuts, motion in band. A model that fails can't film multi-shot sequences; it falls back to take-chained single shots. | Engine (shown in the book) |
| 7. Previz + book | Animatic of keyframes, voice and timing; the Production Book with cost, reserve, model test and every decision. | **Creator gate 2** (locks the budget) |
| 8. Film | Each sequence in one call, independent sequences in parallel; a sequence that continues another in one unbroken shot opens on that take's real last frame. | Engine |
| 9. Critics | Per sequence: planned cuts present and no unplanned ones (scene-change detector), identity across cuts, motion band, dialogue, joins at sequence boundaries. One reroll inside the reserve, then the creator. | Engine |
| 10. Sound | Voice (blueprint), music (brief + brand memory), effects only when asked. | Engine |
| 11. Edit + final critic | Cut at planned in and out points, mix, text; whole-film review (contact sheet, joins, pacing, loudness) before delivery. | Engine, then delivery |

## What stays from v5

The parts that work and carry no film logic: providers and live prices (`apimart`, `kie`, `providers`, `pricing`),
the ledger and budget lock, the guard, the freeze and stop rules, the voice, music and effects libraries, the bible
(sheets, sets, styles), identity and dialogue checks, and the edit/mix code.

## Sequence mode: continuous camera (the standard)

A scene is generated as ONE continuous take: the camera travels from each shot's view to the next (push in to the
close-up, pull back to the wide) at the planned times, with no cut inside the scene. Hard cuts happen only between
scenes (another place or moment). Measured on Seedance 2.0 Mini (12 s, three views): the model honored the views as
camera moves, kept the same face, set and light, motion 4.2, zero cuts. It did not honor hard cuts written as
"Shot 1 / Shot 2"; the `cuts` mode stays available only for a model whose sequence test shows real cuts. Every
sequence test is recorded in `engine/data/sequence-tests.json`.

Screens never carry words the model paints: the sequence prompt says so, and the screen-text critic (local OCR)
fails any take with a readable word.

## Keyframes and identity

The storyboard draws one opening keyframe per scene (judged against the sheets and the set map) and no last frames;
the camera reaches the other views inside the take, and the animatic holds the scene's keyframe for them. A scene
longer than the model's clip continues the previous take, at most two scenes in a row (`MAX_CONTINUE`); the next
one opens on a fresh drawn keyframe. Before a scene continues a take, the IDENTITY GATE checks the faces in that
take's last 1.5 s against the approved anchors; if they drifted, the scene opens on its own drawn keyframe instead
(REKEY, drawn by the autopilot). Every call carries the cast's character sheets as references.

## Built (2026-10-28)

- `lib/direction.mjs`: shot sizes and angles, `grammar()` (jump cuts, size variety, shot-length bands per vertical in `SHOT_BANDS`), `planSequences()`, `cutsOf()`, `sequencePrompt()`, `directionShots()`.
- `lib/critics.mjs`: `detectCuts()` (scdet at 6, calibrated on real takes) and `cutsMatch()` (planned cuts present, none unplanned).
- `gen.mjs sequences <slug>` (plan, free) and `gen.mjs sequence <slug> --seq <id> [--test --model --said]`: one call per scene with the opening keyframe, the later shots' frames and the cast's sheets as references; critics; a passing take is split into its shots' takes at the real cut points.
- Models that cut inside one generation are marked `multiShot` (Seedance 2.x); the price analysis prefers them when scenes have cuts.
- Autopilot: sequence tests before the book, sequences filmed in order where they continue each other, in parallel otherwise.
- Board of every clips vertical (new projects): shot size, place and grammar per shot.
- Final QC: every cut in the final must be a planned one, placed at the launch plan's timing.
- Still critic on every sequence take (`lib/critics.mjs stillCheck`), and `accept-take` on takes filmed as a sequence (`gen.mjs sequence --accept n`).
- The vision judge skips a provider that just failed, across processes (`lib/judge.mjs`).

## Next

- Measure `multiShot` per model with a paid sequence test and record it in `engine/data/model-fit.json`.

## Build order

1. `lib/direction.mjs`: shot sizes, angles, film grammar, sequence planning and the multi-shot prompt, for every vertical.
2. `gen.mjs sequence`: one generation per sequence with references and opening keyframe; critics in `lib/critics.mjs`
   (planned cuts vs detected cuts, identity, motion, joins).
3. Launch flow on sequences (plan → sequences → keyframes → film → build); autopilot follows.
4. The other clips verticals (UGC, cinematic, fantasy, influencer, podcast) on the same direction layer.
5. Whole-film critic before delivery.
