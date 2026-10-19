# AI Video Factory: instructions for agents

An AI video studio run by a coding agent. You write and direct; `engine/` talks to Kie.ai (images, video, music, vision judge) and ElevenLabs (voices, sound effects); the user approves two gates.

**First time here?** If `studio.json` doesn't exist at the repo root, follow `SETUP.md`, then the onboarding skill (`.claude/skills/onboarding/SKILL.md`).

**Every request:** read `studio.json` (the creator's profile), then `.claude/skills/studio/SKILL.md` (the pipeline and its non-negotiable safeguards), then the vertical DNA file it points to. Skills are plain Markdown in `.claude/skills/*/SKILL.md`: if your agent doesn't load them automatically, open and follow them yourself.

## Rules
- **Flow v5 is the only path.** Every video starts with `node engine/studio.mjs new` (the 7-question intake) and moves only by `node engine/studio.mjs status <slug>`. Approvals record the user's own words (`studio.mjs approve <slug> <step> --said "..."`). The engine refuses any step out of order; a Claude Code hook (`.claude/settings.json`) denies one-off scripts that call Kie or ElevenLabs and any video sent without a delivery receipt.
- **Never spend past the approved budget.** Approving the Production Book locks it in code; `gen.mjs` refuses any job past it, and any video job before it. Any extra spend needs the user's explicit yes, then `node engine/phase.mjs budget <slug> --add N --said "..."`.
- **Creative calls are the user's.** Captions, zoom, crops, cuts, music, voices, look: offer options, wait for their choice.
- **The user's gates:** concept, script, cast, the Production Book (locks the budget) and the retro; plus the series bible for a new series. Nothing paid in video happens before the book.
- **Best quality for the lowest cost, from live prices.** No video model is excluded by rule. Before every Production Book, `node engine/studio.mjs prices <slug>` analyzes Kie's live prices and recommends the best quality that fits the budget; the flow won't build the book without it. Images: GPT Image 2.5 (`gpt2.5`).
- **At most one reroll per scene**, and only inside the budget. Never change the engine in the middle of a production: deliver, report, fix after.
- **Watch the whole final** before delivering: `studio.mjs qc` (identity across every cut, transcript, format, loudness, contact sheet), then `studio.mjs deliver`. Never hide a known problem.
- **Keys** live only in `.env`. Never print them, never put them in commands, commits or URLs.
- **Likeness and IP:** only the user's own face and voice (with consent) for "clone me". Never real public figures, copyrighted characters or brands the user doesn't own. Never name real shows or actors in prompts.
- Reply in the user's language.

## Formats and where they live

| The user wants | Skill / DNA |
|---|---|
| Any video (entry point) | `studio` |
| UGC ad | `studio` + `verticals/ugc-ad.md` |
| Micro-drama / vertical novela series | `format-series` + `verticals/micro-drama.md` |
| Sitcom or comedy series | `format-series` + `verticals/sitcom-90s.md` + `sitcom-writing-bible.md` |
| Fantasy short | `studio` + `verticals/fantasy-short.md` |
| Meditation, sleep, ambient, focus (10 min to 3 h) | `format-longform` + `verticals/meditation-longform.md` |
| AI influencer / clone me | `studio` + `cast` + `verticals/influencer-talking-head.md` |
| Anime, cinematic, podcast clip | `studio` + the matching DNA |
| Scripts and jokes | `story-architect` |
| Shot lists and continuity | `cinematographer` |
| Characters, sets, voices | `cast` |

## Engine map
- **Flow:** `studio.mjs` (intake, status, approvals, `accept-take`, `override`, final `qc`, `deliver`), `lib/flow.mjs` (recipes, `requireStep`), `phase.mjs budget`, `radio.mjs` (radio cut + pacing QC), `book.mjs` (Production Book, every format).
- **Generation:** `gen.mjs` (all paid generation; budget guard in `job()`), `series.mjs` (series intro), `cast.mjs`, `style.mjs`.
- **Evaluation:** `continuity.mjs` (vision judge; `--identity`, `--jumps`), `lib/identity.mjs` (faces and marks against the locked face anchor), `lib/jumps.mjs`, `lib/dialogue.mjs`, `qc.mjs`.
- **Editing:** `edit.mjs` (scenes formats), `cut.mjs` (clips formats: influencer, UGC, cinematic...), `longform.mjs` (long-form ambient), `animatic.mjs`.
- **Data:** `bible/` (characters, sets, styles, sound library), `series/<id>/`, `projects/<slug>/` (shotlist, ledger, renders), `templates/` (starting points).
- **Money:** 1 Kie credit = $0.005. Each project's spend is in `projects/<slug>/ledger.json`.
- **Checks:** `npm run doctor` (machine), `npm run check` (offline smoke tests and a secret scan).
