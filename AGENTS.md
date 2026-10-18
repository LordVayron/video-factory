# AI Video Factory: instructions for agents

An AI video studio run by a coding agent. You write and direct; `engine/` talks to Kie.ai (images, video, music, vision judge) and ElevenLabs (voices, sound effects); the user approves two gates.

**First time here?** If `studio.json` doesn't exist at the repo root, follow `SETUP.md`, then the onboarding skill (`.claude/skills/onboarding/SKILL.md`).

**Every request:** read `studio.json` (the creator's profile), then `.claude/skills/studio/SKILL.md` (the pipeline and its non-negotiable safeguards), then the vertical DNA file it points to. Skills are plain Markdown in `.claude/skills/*/SKILL.md`: if your agent doesn't load them automatically, open and follow them yourself.

## Rules
- **Never spend past the approved budget.** Approving the Production Book (or a long-form estimate) locks it in code; `gen.mjs` refuses any job past it. Any extra spend needs the user's explicit yes, then `node engine/phase.mjs budget <slug> --add N --note "..."`.
- **Two gates:** the script (gate 1) and the Production Book or estimate (gate 2). Nothing paid happens before gate 2.
- **Cheapest option that keeps quality.** Check live prices with `npm run prices`. Images: GPT Image 2.5 (`gpt2.5`). Default video: Seedance 2 Mini (`sd2-mini`), 480p for sitcom, 720p for the rest.
- **At most one reroll per scene**, and only inside the budget. Never change the engine in the middle of a production: deliver, report, fix after.
- **Watch the whole final** before delivering (a contact sheet plus the transcript against the script). Never hide a known problem.
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
- **Planning:** `phase.mjs` (phases, `approve`, `budget`), `radio.mjs` (radio cut + pacing QC), `book.mjs` (Production Book).
- **Generation:** `gen.mjs` (all paid generation; budget guard in `job()`), `series.mjs` (series intro), `cast.mjs`, `style.mjs`.
- **Evaluation:** `continuity.mjs` (vision judge), `qc.mjs`.
- **Editing:** `edit.mjs` (episodes and shorts), `longform.mjs` (long-form ambient), `animatic.mjs`.
- **Data:** `bible/` (characters, sets, styles, sound library), `series/<id>/`, `projects/<slug>/` (shotlist, ledger, renders), `templates/` (starting points).
- **Money:** 1 Kie credit = $0.005. Each project's spend is in `projects/<slug>/ledger.json`.
- **Checks:** `npm run doctor` (machine), `npm run check` (offline smoke tests and a secret scan).
