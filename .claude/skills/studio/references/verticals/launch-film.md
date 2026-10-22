# Vertical DNA: Product launch film

A 30-second film that makes people understand a product and remember it. **Claude is the creative director here, not a clip stitcher.** No image gets made until the brief, the concepts and the timed plan are approved. Engine: `engine/lib/launch.mjs` (contracts and rules), `engine/launch.mjs` (plan tools and editor). Format id: `launch`.

**Every rule below is enforced in code, for any video model** (the creator picks the model). The full map of rule → code → test is `docs/launch-rules.md`; a lesson is not done until it is there.

## Calibrated on Town (2026-10-21, after the first launch film v1 felt "disconnected")

Measured with `launch.mjs reference <slug> --file <video>` (whisper transcript, never silence detection: v1 was planned on a wrong "music only" reading):

| | Town | First film, v1 | Rule now |
|---|---|---|---|
| Narration | 83 words, 170 wpm, voice over 98 % of the film, longest gap 1.0 s | 48 words in one-line fragments, gaps, two voice sources | **One continuous narration** (2.0–3.0 words per second of film, or ±25 % of the reference); every shot but the brand ending speaks; **recorded in one take** (`launch.mjs voice --take`) and **the picture is cut to it**; no silence over 1.2 s, coverage ≥ 75 % |
| World | one town, the same buildings near and far | five unrelated places | `style.world`; every cut declares **how it follows** (`connect`: action, object, push-in, pull-out, same-place, pov) |
| Thread | the user's giant hand in most shots, leading every cut | two different hands, unplanned | `style.thread` in ≥ 40 % of shots, in the first and last third |
| Cuts | hard cuts motivated by the hand or the object | slides, a circle wipe | only `cut` or `fade` ≤ 0.35 s |
| Look | brightness 187, saturation 15, one flat high-key light | 114–152, light changed to golden hour | one time of day (the style bible's); the editor **levels every shot** to `style.grade` or the film's median |
| Proof | the product drawn inside the world (chat bubbles, documents) | photoreal clips in the TVs | real footage gets the **storybook treatment** (warm grade, softer saturation, paper grain) |
| Mix | 2.9 dB across 2 s windows | 10 dB | **≤ 6 dB** (editor QC); music without drums under a narration; gentle ducking |

## The reference, and what we take from it

The reference is the 30.06 s Town launch film (1280×720, 24 fps), measured 2026-10-21:
- **Cuts and length:** 11 cuts, so about 12 beats; most shots run 2–5 s.
- **Sound:** a continuous narration (83 words) over gentle music and effects. (The first reading said "no voice-over": it came from silence detection, and it was wrong.)
- **Opening:** first-person views of an oversized hand.
- **The world:** a hand-drawn miniature town where small characters do the work.
- **Interfaces:** a clean chat interface shown on a plain card.
- **Ending:** the logo, after the world and its benefits have been shown.

**Take the principles, not the film:**
1. Show the outcome before you explain how it works.
2. Turn the abstract work into one concrete metaphor.
3. Characters *do* the product's job on screen.
4. Build one consistent world.
5. Give every shot one purposeful action.
6. Reveal the brand when it has been earned.

**Never copy** Town's characters, town, compositions, typography, logo or scene order. Every product gets its own metaphor: a shipping hub, a kitchen, an orchestra, a newsroom, a workshop, or whatever the strategy picks.

## The creative process (the interview comes first)

1. **Intake:** `studio.mjs new --format launch`, the 7 questions. Release 1 accepts 30 to 35 s, 16:9 and 24 fps. In P7 (refs), the creator gives the **landing page link or the launch context**.
2. **Read the source.** Fetch the landing page with WebFetch and pull out:
   - category, what the product does and for whom;
   - the pain, the current alternative and the outcome;
   - the mechanism and the proven capabilities;
   - the CTA.

   Every fact gets its source; a URL also gets `retrievedAt`.
3. **Interview the creator, one question at a time with buttons.** Ask only what the page doesn't answer, but **always confirm**:
   - the ICP (one person, not "everyone");
   - the dominant pain and its consequence;
   - the proof moment (what the viewer sees the product produce);
   - the differentiator, if there is evidence for it;
   - the CTA;
   - the intent: **Brand** (desirability, recall) or **Conversion** (pain → demo → proof → CTA);
   - voice-over yes/no, captions yes/no, music yes/no;
   - claims that must not appear.

   Then add the questions the process needs: tone, the brand assets he owns (logo file, licensed font, palette), and screenshots for UI cards.

   Record every Q&A in `brief.interview`. Every inference becomes an `assumption` that the creator approves (`approved: true`) or rejects.
4. **Brief** (`launch/brief.json`): product, ICP, capabilities with sources, CTA, constraints, unknowns, assumptions and the **message map**:
   - one ICP, one pain and its consequence, one promise;
   - before → after;
   - one proof tied to a capability, an optional differentiator tied to a capability;
   - one emotion, one CTA.
5. **Concepts** (`launch/concepts.json`): the film config plus **three meaningfully different concepts**. Each one has:
   - thesis, metaphor and why the metaphor maps to the product;
   - hook, objection and arc;
   - proof and brand reveal;
   - risk, effort and rationale.

   Recommend one, with the story mode and why (`modeRationale`). The creator picks.
6. **Gate concept:** `concept.md` summarizes the chosen concept. `launch.mjs check` must be clean. Then `studio.mjs approve <slug> concept --said "..."`.
7. **Timed plan** (`launch/shot-plan.json`): see "Plan rules" below. **Gate script.**
8. **Style bible** (`launch/style-bible.json`):
   - palette (hex), line, texture, light, depth, camera, text treatment;
   - "never" rules;
   - characters (bible ids, made with `cast.mjs` in the `storybook` style);
   - environments with stable ids and key art (`ref`);
   - brand: name, logo file if any, safe margin, exact UI labels.

   **Lock the visual identity:** one key image of the world (`gen.mjs still --project`), approved with `studio.mjs approve-look <slug> --file <img> --said "..."`. Pick the narrator's voice (`sl.launch.voice.eleven`). **Gate cast.**
9. **Board:**
   1. `launch.mjs apply`;
   2. `gen.mjs frame <slug> <id> first --planned` for every generated or still shot;
   3. `launch.mjs voice`, which records the voice-over and measures each line against its room;
   4. `launch.mjs animatic`, which builds the frames, voice and text at the exact timing.

   Show the creator the storyboard animatic and approve it in their words **before any frame is paid for** (`launch.mjs animatic <slug> --approve --said "..."`; `gen.mjs frame --planned` refuses without it), then again once every frame is drawn (the board refuses without it). A shot chained `exact` gets the previous shot's last frame copied for free; `same-set` is drawn from it with the same framing.
   Before the book, film one shot as a **motion test** on the chosen model (`gen.mjs clip <slug> --shot <id> --test --model <k> --said "..."`), or record their waiver (`launch.mjs waive-test`).
10. **Prices → book:** `studio.mjs prices`, then `book.mjs`. The book shows the strategy, the concepts, the timed plan, the style board, the prompts and the cost. The creator approves it, which locks the budget.
11. **Film:** `gen.mjs clip --shot <id>` for each generated shot (the pilot rule applies). Then `gen.mjs music` and `gen.mjs sfx`.
12. **Edit:** `launch.mjs build`. Watch the whole film, then write `launch/quality-report.json` with the final's sha.
13. **QC and delivery:** `studio.mjs qc`, then `studio.mjs deliver` (receipt + `out/<slug>-package/`).

## Story by intent and mode

**Brand pattern:** curiosity → relatable friction → new possibility → product behavior → better reality → branded ending. A metaphor-led opening is fine, but the viewer must still infer the problem.

**Conversion pattern:** specific pain (said or shown by 3 s) → consequence → solution → visual demo → proof → visible CTA as the last shot.

**Modes:**
- **Story-driven:** characters and a metaphor; the product as an intervention.
- **Explainer:** problem → mechanism → clear demo → outcome.
- **Motion graphics:** kinetic type, UI, diagrams (cards and stills).
- **Cinematic:** emotion, sound, a staged reveal, restrained copy (≤1.4 words per second of film).
- **Performance:** a fast explicit pain hook, the benefit, proof, a visible CTA.

Mode and visual style are separate choices. Release 1 has one style: `storybook` (Whimsical Illustrated World, `bible/styles/storybook`).

**Editable 30 s blueprint:**
| Time | Beat |
|---|---|
| 0–4 | friction or an unusual point of view |
| 4–8 | the problem made tangible with the metaphor |
| 8–12 | the new possibility |
| 12–17 | real product interaction |
| 17–24 | 1–2 mini-demos with a visible proof artifact |
| 24–27 | the improved reality |
| 27–30 | brand, memory anchor, CTA |

## Plan rules (enforced: `lib/launch.mjs planRules`)

- **Timing:**
  - shots contiguous, each 1–8 s, summing to the length ±0.25 s;
  - for 30 s, 6–14 shots, and at least 60 % of them in the 1.5–5.5 s band.
- **Voice-over:**
  - at most 2.2 words per second of film (about 66 for 30 s; aim for 45–65 when it runs most of the film, fewer with music-only stretches);
  - each line ≤ ~2.7 words per second of its shot;
  - measured afterwards on the real audio (`launch.mjs voice`: each line must fit before the next one).
- **Exact text is the editor's job:**
  - a prompt with quoted text, "logo", "caption" or "that reads" is blocked;
  - on-screen text goes in `shot.text` (title, label, cta or ui), with its words and screen time checked;
  - brand name and logo go in `shot.logo`.
- **Claims:** a number, a superlative or a promise of speed in the voice-over or on screen needs `shot.claim` pointing to a capability in the brief. Never invent metrics, testimonials, integrations or prices.
- **Proof:** one shot with role `proof` tied to `message.proofCapability`. At least one `interaction` or `demo`.
- **Brand:** the logo or the product name in the last 4 s. A brand film ends on a `brand` or `cta` shot; a conversion film ends on a `cta` shot whose CTA text matches the brief.
- **Continuity:** every drawn shot names an environment of the style bible in `assets`, and characters are referenced by bible id. Two shots in the same place are chained (`chain: "exact"` or `"same-set"`); an `exact` join is measured in the film (SSIM ≥ 0.80).
- **The creator's words:** `transitionAsked.said` for any transition, `zoomInto.said`, `sfx.<name>.said`, `text[].said` (only the brand and the CTA go unasked), `said` on every edit decision.
- **Story:** the first shot hooks (hook/friction/problem, voice by 0.5 s); the pain shows before 8 s; every character in frame does something named in `motion`; one hand per shot; at most three actions per shot; nothing falls near a pile.
- **Pauses:** `shot.pause` (seconds after its line) survives every narration re-cut.
- **Shot sources:**
  - `generate`: first frame + animated clip (the expensive one);
  - `still`: a first frame the editor pushes in slowly;
  - `card`: a deterministic graphic for UI, proof or brand.

  Use stills and cards to save money and to keep text exact.

## Picture (storybook preset)

- Hand-drawn 2D with organic ink lines, watercolor fills, a pastel palette, paper grain, layered cut-out depth, warm daylight.
- One focal action per frame. Leave clean space where the text goes.
- **Camera:** gentle drift or a small push, a rare tilt. First-person shots with an oversized hand show the user's agency.
- **Avoid:** 3D gloss, plastic, photorealism, neon, night scenes, morphing, letters, logos.
- **Video model:** whatever `studio.mjs prices` picks (floor quality 7). Takes are silent (`sound: false`), which is often cheaper.

## Sound

- **Voice-over:** ElevenLabs, recorded before the book.
- **Music:** Suno, with an arc: curious opening, momentum through the proof, warm resolution and a short sting. The editor shapes it per shot (`music: low/mid/high`) and ducks it under the voice.
- **Effects:** diegetic and tactile (paper, clicks, a bell on delivery), defined in `plan.sfx`.
- **Final mix:** -14 LUFS, true peak -1.5.

## QC (`studio.mjs qc`)

- **Format:** H.264 yuv420p, 1280×720, 24 fps, exactly 720 frames (±1), -14 LUFS.
- **Voice-over:** heard word for word.
- **Text:** every on-screen text read back from the frames by the judge.
- **Characters:** identity of any bible characters across cuts.
- **Quality report** (`launch/quality-report.json`, tied to the final's sha), written by Claude after watching the whole film:
  - heuristic scores from 1 to 5, each with a reason, for ICP pain, comprehension, narrative, continuity, proof, motion, brand, CTA, sound and format;
  - findings with timecodes; any blocker, or a score of 2 or less, fails the QC.

  These are editorial heuristics, never a forecast of conversions.

## Delivery

`out/<slug>.mp4` plus `out/<slug>-package/`:
- `creative-brief.json`, `concepts.json`, `script.md`, `shot-plan.json`, `style-bible.json`;
- `quality-report.json`, `production-manifest.json` (every shot → its source, take, prompts, evals and cost);
- captions `.srt` if any, and `poster.jpg`.

## Not in Release 1 (offered as "todavía no disponible", never half-working)

- 15, 45 and 60 s;
- 9:16 and 1:1;
- 30 fps;
- other visual styles;
- transitions the creator did not ask for (any transition, zoom, effect or text needs `said`);
- automatic URL ingestion inside the engine (Claude reads the page and records the source);
- A/B variants.

## Failure modes to watch

- **Concepts that tell a story but don't launch the product** (2026-10-21, the first launch film: a tiny rental store, a night crew and a pop-up book were rejected as "not launch videos"). Every concept must present the product: what it is, who it's for (the real range of its users, not one narrow persona) and what it makes. A metaphor is good only when it carries those three. The product's own name is often the best metaphor.

- **Three concepts that are the same idea:** the rule compares their metaphors and theses.
- **A metaphor so clever the viewer can't tell what the product does:** the brief's pain must be readable by 8 s.
- **Generic magic instead of product behavior:** there must be an interaction or demo shot.
- **Text drawn by the model:** blocked; composite it.
- **Hands and tiny characters:** first-person hands are risky. Keep them simple and one per shot; the evals and the contact sheet catch the rest.
- **The video model choreographs when we don't** (the first launch film, v2-v3). Kling invents motion in any pile it can see: idea cards turned see-through and faded out, tapes in the cart jumped out or turned into a blob. Write every movement and its end state; never ask for a fall or drop near a pile; let the camera carry the motion (a pan whose first and last frames are two crops of one image costs nothing to draw). Review every take frame by frame at 4 fps before the final (`launch.mjs review`); rescue a bad take with `retime` or `splice` before paying for a reroll.
- **Fragmented shots and transitions nobody asked for** (the first launch film, v5). The creator accepted the film only when it played as one continuous story (v6): the board and the closed laptop drawn in one set, the first shot ending on the second shot's exact first frame, and a water ring (`ripple`) from the point where the card touches the screen into the town. A slide-up between two heights of the desk, an idle hand at the end and loud effects were all rejected. Never add a transition or effect the creator did not ask for; design each cut as a story beat and show it in the storyboard first.
