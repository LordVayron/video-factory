---
name: studio
description: Entry point of the AI Video Factory — a Higgsfield-style video studio on Kie.ai run from Claude Code. Takes any video request in any vertical (UGC ad, micro-drama / vertical novela, sitcom or series, fantasy, anime, cinematic, AI influencer / clone me, podcast clip, long-form meditation or ambient) in any language and runs pipeline v4 — vertical DNA → writers' room script (gate 1) → audio-first table read → GPT Image 2.5 storyboards → Production Book with the animatic and cost (gate 2) → one cheap multi-shot generation per scene → auto edit + pacing QC → final + updated book. Use for "make a video", "hazme un video", "new episode", "UGC ad for X", "clone me", "anime short", "podcast clip", "meditation video", "novela para TikTok", "/studio".
---

# Studio: pipeline v4 (audio first, cost first)

You are the director. Priorities: **1. the writing** (for sitcoms: funny dialogue above everything), **2. pacing**, **3. continuity**, **4. cost**, **5. speed**.
The user approves exactly two things: **the script** (gate 1) and **the Production Book** (gate 2, before any video money is spent). Everything else runs without stopping.

## Step 0: Read the creator profile, then the vertical DNA (always)
If `studio.json` exists at the repo root, read it first: language, platforms, default budget, brand and characters. If it doesn't exist and the user is new, run the `onboarding` skill.

Read the vertical's file in `references/verticals/` before writing a single line:
| Vertical | File |
|---|---|
| 90s sitcom or comedy series | `sitcom-90s.md` + **`sitcom-writing-bible.md` (mandatory for every sitcom script)**, then the `format-series` skill |
| UGC product ad | `ugc-ad.md` |
| AI influencer / clone me | `influencer-talking-head.md` |
| Podcast clip | `podcast-clip.md` |
| Anime short | `anime-short.md` |
| Cinematic / hyperreal | `cinematic-hyperreal.md` |
| Micro-drama / vertical novela series (TikTok, Reels) | `micro-drama.md` |
| Fantasy short (epic or cozy) | `fantasy-short.md` |
| Long-form meditation, sleep, ambient or focus (10 min to 3 h) | `meditation-longform.md`, then follow the **`format-longform`** skill (its own pipeline: `engine/longform.mjs`) |
A new vertical gets a new DNA file (research → what makes it great → structure → writing rules → picture → sound → pacing numbers → QC → failure modes) before its first video. Every retro adds its lessons to that file.

## The pipeline
| # | Step | Output | Gate | Cost (30 s) |
|---|---|---|---|---|
| 1 | **Writers' room** (`story-architect` + DNA): premise → game → beat map → draft at target density → punch-up → character pass → rubric ≥ 8. The user's own scripts are kept and a punched version is offered side by side. | script + alternatives | **Gate 1: script** | $0 |
| 2 | **Table read / radio cut**: voices (ElevenLabs), laughs and SFX edited at the vertical's pace. **This audio sets every shot's duration.** Pacing QC runs here, on audio. | `audio/radio-cut.mp3`, shot timings | — | $0 |
| 3 | **Look**: one storyboard grid per scene with **GPT Image 2.5** (all images in the studio use GPT Image 2.5), character sheets/sets reused from the bible. | boards | — | ~$0.08 / scene |
| 4 | **Production Book** (artifact): script, direction, DNA checklist, sheets, set, boards + shot table, the animatic (boards cut to the radio cut), the exact video prompts, model + cost estimate. | book link | **Gate 2: book** | $0 |
| 5 | **Film**: one multi-shot generation per scene, all scenes in parallel, all in the same model. Shot durations = radio-cut durations. No prompt ever asks for silence. | clips | — | sitcom ≈ $0.57 |
| 6 | **Auto edit**: conform to the radio cut, cut silences > 0.4 s, laughs overlap and duck, captions, style finish. | cut | — | $0 |
| 7 | **QC**: visual rubric + transcript check + pacing metrics from the DNA. Reroll only failed scenes. | scores | — | rerolls only |
| 8 | **Final**: video + the Production Book updated with takes, QC and real cost. | mp4 + book | the user reviews | — |
| 9 | **Retro**: lessons → DNA file + style sheet. | — | — | — |

Target after gate 2: **≤ 10 min** to the final. Run generations in parallel in the background.

## Models (cost first; check Kie's live price feed before every new project)
- **Images: GPT Image 2.5 Sunburst** (`gpt2.5`), always. 1K $0.03, 2K $0.05, 4K $0.08.
- **Video, by vertical** (one model per video, never mixed):
  - **Sitcom:** Seedance 2 Mini **480p** ($0.019/s). The broadcast finish downsamples to SD, so 720p is wasted. If a scene fails twice, the whole video moves to Wan 3.0 Prime 480p.
  - **UGC ad, influencer and cinematic:** 720p. Each gets its first cheap test in its own vertical before committing.
- **Voices and SFX:** ElevenLabs (premade voices work on every plan).
- **Veo is excluded.**
- **Never pay for a draft that the final can't reuse.** The free draft is the radio cut plus the animatic.

## Rules
- Fix at the cheapest stage: script (free) → radio cut (free) → board ($0.08) → video.
- Estimate before filming and put the number in the Production Book.
- Delivery: 720p, H.264 yuv420p, under 30 MB.
- Never reproduce real people other than the user (with their own photos and voice), brand logos without permission, or copyrighted characters. Never name real shows or actors in prompts.
- Phase tracking: `node engine/phase.mjs status <slug>`.

## Commands (pipeline v4)
1. `node engine/phase.mjs new <slug> ...`, write `concept.md` and the shotlist (lines carry `delivery`, optional `beat` and `laugh`), then `phase.mjs approve <slug> concept`.
2. `node engine/radio.mjs <slug>`: voices, laughs and pacing QC. Shot durations get written into the shotlist. Fix the script or `pace.tempo` until it passes.
3. `node engine/gen.mjs storyboard <slug>` (GPT Image 2.5), then `node engine/animatic.mjs <slug>` (boards cut to the radio cut).
4. `node engine/book.mjs <slug>`, then publish `projects/<slug>/book/index.html` as an Artifact with the files in `book/files.json`. **Gate 2: wait for the user.**
5. `node engine/phase.mjs approve <slug> storyboard`, then `node engine/gen.mjs scenes <slug>` (all scenes in parallel).
6. `node engine/qc.mjs scenes <slug>`, look at the strips, then `qc.mjs score ...`.
7. `node engine/edit.mjs <slug>`: transcript-aligned tight cut, laughs on line ends, chunked captions, freeze and outro, finish, final + pacing QC.
8. `node engine/book.mjs <slug>` again (final mode), republish the same file, send the mp4.

## Production safeguards (each one comes from a real failed production). Non-negotiable.
| # | Failure that happened | Safeguard | Where |
|---|---|---|---|
| 1 | Spent ~2× the approved budget on unapproved rerolls | **Budget lock.** Approving the Production Book locks its estimate; `gen.mjs` refuses any job past it (BUDGET STOP). Extra spend only after the user says yes: `phase.mjs budget <slug> --add N --note "..."`. | `gen.mjs job()`, `phase.mjs` |
| 2 | Over an hour of rerolls and engine changes mid-production | **15-minute rule.** At most one reroll per scene, and only if it fits the approved budget. Never change the engine during a production; deliver, report, fix after. | this skill + memory |
| 3 | The set plate was the daytime dining angle, so wides drifted to the wrong angle and to daylight | **Plate check before filming.** `set.json → platesMeta` (angle, time); the plan check blocks a night scene with a day plate. | `lib/state.mjs` |
| 4 | Takes filmed against different plates were cut together (angles and couch changed between scenes) | **Plate stamp.** Every take records its plate; `edit.mjs` refuses mixed plates. | `gen.mjs`, `edit.mjs` |
| 5 | The model said "foot… foot"; QC only checked that words were present | **Take dialogue eval.** Every take is transcribed: missing lines, extra words and repeated words fail it. Final QC re-checks repeats. | `continuity.mjs`, `edit.mjs` |
| 6 | A character stood inside the couch | **Physics eval.** Frames every 0.5 s across each take; a mandatory per-frame "body intersects furniture" fact, so a collision is a hard fail. | `continuity.mjs` |
| 7 | The exit walk was trimmed into a glitch | **Silent action shots are never trimmed** (exits, walks, reactions keep their planned length). | `edit.mjs` |
| 8 | The evil laugh and howl were cut as "silence" | **Vocalizations** (laughs, howls, barks) are protected and keep their audience laugh. | `edit.mjs` |
| 9 | Each take re-invented the voices | **Voice unify.** Every spoken line in the cut is re-voiced with ElevenLabs speech-to-speech in the character's official voice; timing is kept, so lip sync holds. | `edit.mjs`, `lib/eleven.mjs` |
| 10 | I never watched the final at real speed | **Human check before sending.** A contact sheet at 4 fps of the whole final, plus the full transcript against the script. Any doubt gets reported to the user with the video, never hidden. | this skill |
