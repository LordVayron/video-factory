# Quality control

## Checkpoints
| CP | When | Who/what checks | Gate |
|---|---|---|---|
| 1 | After the script | Storytelling checklist (hook, but/therefore, button, line length) | Show the user before any spend |
| 2 | After keyframes | Visual judge on sheets: keyframe beside character refs + set plate | `gen.mjs video` refuses unpassed frames |
| 3 | After each clip | Free tech checks + visual judge on a 6-frame strip beside the keyframe | `assemble.mjs` refuses unpassed clips |
| 4 | After assembly | Loudness −14 LUFS ±2, true peak < −1 dBFS, no dead air > 0.8 s, duration ±1 s, all shots passed | Report before delivering |

## Rubric (1–10; 7 = shippable, 9+ = indistinguishable from real footage)
Pass = every criterion ≥ 7 **and** average ≥ 8 (set per project in `shotlist.json` → `"qc": { "minEach", "minAvg", "maxRerolls", "escalate" }`).

**Frames:** identity · anatomy · set · framing · look
**Clips:** identity · anatomy · set · action · look · speech (10 if no dialogue)

Definitions are in `engine/qc.mjs` (`RUBRIC`) and printed in every review packet.

## What "looks bad" usually is
- **Wandering camera:** the model pushes in or pans and invents a new room. Tech check flags first→last similarity < 0.45 on a locked shot; confirm on the strip. Fix: the engine now adds an explicit tripod-lock clause; reroll with "camera locked on a tripod".
- **The action doesn't happen** (the Roomba doesn't spin, the dog isn't on it). Often the keyframe never showed it: send it back with `--back frame` and describe the frozen moment *mid-action*.
- **Things pop in** (a vacuum cleaner appears because the line says "vacuum"). Fix note: "No other object appears."
- **Wrong framing** (a close-up came out wide). Fails on framing at CP2, which is cheap ($0.02), before any video money is spent.
- **Odd extras** (a stray tail, a second cat): identity/anatomy.

## Fix notes that work
Write the fix as a director's note describing the *result*, not the problem: "Camera locked on a tripod. The woman stays in the doorway and says her line. No other object appears." The queue appends it to the prompt for the reroll.

## Escalation
Each failed take queues a reroll with the fix note. After `maxRerolls` (default 2) failures, the next reroll uses the escalation model (frames → `nbpro`, clips → `wan3-prime`). After that the shot is flagged on the board for a human decision (rewrite the shot, cut it, or accept).

## Automatic judge
`--judge kie` scores with Claude through Kie's Anthropic-compatible endpoint (`https://api.kie.ai/claude`), structured JSON output. It was returning "Internal error" on 2026-10-08; when it fails the packet falls back to session review.
