---
name: cinematographer
description: Turns an approved script into scenes, blocking sheets and shots (projects/<slug>/shotlist.json) built for continuity — each scene is storyboarded as one grid image and filmed as one multi-shot generation, so characters keep their positions, props and screen sides across cuts. Use after the script is approved, when shots break continuity, or when planning coverage for dialogue.
---

# Cinematographer

Read `references/cinematography.md` (film grammar, look) and `references/models.md` (models) once per session.

## Think in scenes, not shots
Research (Higgsfield Popcorn, Wan 3.0 / Seedance 2.0 multi-shot): AI models keep continuity when a scene is generated **together**, and lose it when each shot is generated alone. So:
- **Scene** = one location, one continuous moment, ≤ 15 s, 2–5 shots of 2–5 s each.
- **Storyboard** = ONE grid image per scene (all panels in one generation) → split into panels.
- **Video** = ONE multi-shot generation per scene (`Shot 1 [0-3s] … Hard cut. Shot 2 [3-6s] …`), opening on the scene's first panel, with character and set references and voice references.
- A 20 s episode is typically 2 scenes → 2 grid images + 2 video generations, all run in parallel.

## shotlist.json
```json
"scenes": [
  { "id": "A", "summary": "one line: what happens", "shots": ["s01","s02","s03"],
    "blocking": "Milo sits on the LEFT chair at the round table facing right, paper in front of him; Rex sits on the RIGHT chair facing left; Ana is not in the room." }
],
"shots": [ { "id": "s01", "duration": 3, "characters": ["milo","rex"], "framing": "medium two-shot", "lens": "35mm lens", "camera": "fixed camera",
             "image": "frozen moment for the storyboard panel", "motion": "what changes in this shot",
             "dialogue": [{ "char": "milo", "text": "…", "delivery": "…" }], "sfx": "…" } ]
```

## Blocking sheet (write it before the shots)
For every scene: each character's **position** (which chair, left/right of frame), **facing**, **posture**, **props in hand**, and any **movement with its timing** ("in s03 Rex stands up and moves to the doorway"). If a character moves, the next shot starts where they ended. The blocking text goes into the storyboard grid prompt and the video prompt verbatim.

## Coverage that keeps continuity
- **Anchor with the two-shot.** Dialogue between two seated characters plays mostly in a medium two-shot; cut in for reactions and punchlines.
- **Singles show the geography:** a close shot of one character keeps the table and the other's shoulder or edge in frame (over-the-shoulder), against the same background wall every time.
- **180° rule:** screen sides never flip. Write "Milo frame left, Rex frame right" in every shot that has both.
- **Name the camera in every shot** ("fixed camera", "slow push-in"). Unnamed cameras make Wan cut on its own.
- **Physical comedy in the wide,** so the whole action reads.
- **Cut on action or on the punchline word;** keep the reaction beat (0.5–1 s) after the line.
- **No impossible jumps:** a character can't be at the table in s02 and in the middle of the room in s03 unless a shot shows them moving.

## Before handing off
- Every scene ≤ 15 s with 2–5 shots; the total matches the script runtime.
- Every shot has framing, lens, camera, image, motion, dialogue (or none) and sfx.
- `node engine/gen.mjs estimate <slug>`.

## Continuity logic (hard rules, enforced by `engine/continuity.mjs`)
- **Every scene declares `seats`.** Each character gets a place and a screen side: `{ "rex": { "place": "the RIGHT cushion of the couch", "side": "right" } }`. Prompts repeat it as a SEAT LOCK in every shot, wides included.
- **Nobody changes place off screen.**
  - If the story needs a character somewhere else, add a shot whose `moves` says where to and how, and whose action shows the movement: `"moves": { "rex": { "to": "the rug", "side": "right", "how": "hops down off the couch" } }`.
  - The plan check fails if a later scene starts a character somewhere new without that shot.
- **Singles are dirty singles.** When characters share furniture, a close-up keeps the partner's edge (fur, ear, shoulder) at their screen side. The seat beside the subject is never empty.
- **After filming, run `node engine/continuity.mjs <slug>`.**
  - A vision judge reads one frame per shot and compares it with the plan: furniture/floor, side, teleports, night or day, empty partner seat, room, wardrobe.
  - A failing take can't be cut (`edit.mjs` refuses it). Reroll it with a note naming the violation.
