# Launch film rules: where each one lives in code

Every lesson from the first launch film is enforced by the engine (2026-10-22: every rule lives in code). None of them depends on one video model: the creator picks the model, and model-specific behavior lives in model data (`lastFrame` in `engine/lib/models.mjs`). Each rule names the code that enforces it and the test in `npm run check` that proves it.

| Rule | Enforced in | Test (`scripts/check-launch.mjs`) |
|---|---|---|
| Brief: sourced facts, one ICP, interview, approved assumptions | `lib/launch.mjs briefRules`, concept gate | "the sample brief waits for the creator's interview…" |
| Three concepts that differ | `conceptRules` (metaphor/thesis overlap) | "concepts that are paraphrases…" |
| A concept launches the product (names it or its category) | `conceptRules(c, brief)` | "a concept that tells a story without naming the product…" |
| Release 1 limits (30–35 s, 16:9, 24 fps, storybook) | `conceptRules`, `studio.mjs new` | "options outside Release 1…", "the intake refuses a length…" |
| Timed plan sums to the length; shot lengths; rhythm band | `planRules` | "shot durations must add up…" |
| One continuous narration in one take, picture cut to it, no silence > 1.2 s, ≥ 75 % coverage | `planRules`, `flow.mjs launchBoard`, `launch.mjs voice --take` | "a narrated film keeps talking…", "the narration is recorded in one take…" |
| Narration re-cut keeps the creator's pauses (`shot.pause`) | `launch.mjs takeVoice` | "a narration re-cut keeps the creator's pauses" |
| Every cut says how it follows (`connect`) | `planRules` | "every cut says how it follows…" |
| Two shots in the same place are chained: `exact` (starts on the previous drawn last frame, copied free) or `same-set` (drawn from the previous frame, same framing) | `planRules`, `gen.mjs frame` | "two shots in the same place must be chained…", "chain exact copies…" |
| A chain `exact` join is invisible (SSIM ≥ 0.80, measured on the film) | `launch.mjs build` | "the editor measures every chain exact join…" |
| No transition, zoom, effect or on-screen text the creator didn't ask for (`transitionAsked.said`, `zoomInto.said`, `sfx.<n>.said`, `text.said`; only brand and CTA go unasked) | `planRules` | "a transition the creator didn't ask for…", "an effect…", "on-screen text…" |
| Vertical tilt only within one place; fades ≤ 0.35 s; `zoomInto` ends in a fade or ripple | `planRules` | "a vertical tilt is only allowed…" |
| One thread opens and closes the film (waivable only in the creator's words) | `planRules` (`threadCloseWaived`) | "one thread opens and closes the film" |
| One time of day; one world; world rules restated in every shot that shows them | `planRules` | "the light never changes", continuity rules |
| Every shot animated (no stills with zoom) | `planRules` | "every shot is animated…" |
| Choreography: drawn last frame (`end`), `still` list, no vague verbs, falls need a cause and a landing | `planRules` | choreography tests |
| Nothing falls near a pile | `planRules` | "nothing falls near a pile…" |
| Nothing idles: every character in frame does something named in `motion` | `planRules` | "a character in frame with nothing to do…" |
| One hand per shot; one clear action per shot (≤ 3) | `planRules` | "one hand per shot…", "one clear action per shot…" |
| The first shot hooks (hook/friction/problem, voice by 0.5 s); the pain is readable by 8 s | `planRules` | "the first shot hooks…", "the pain must be readable by 8 s" |
| No text asked of a model; exact text, CTA and brand composited | `planRules`, `launch.mjs build` | "a prompt that asks the model for exact text…" |
| Claims tied to proven capabilities; proof and demo shots; brand in the last 4 s, ending ≥ 3.5 s | `planRules` | claims, proof, brand tests |
| No beat under a narration | `planRules` | "no beat under a narration" |
| Standard character sheet per character, never a group | `lib/modelsheet.mjs`, cast gate | "standard sheet…" |
| The creator approves the storyboard animatic of the plan before any frame is paid for, and again with every frame drawn | `flow.mjs launchBoard`, `gen.mjs frame`, `launch.mjs animatic --approve` | "the board waits for the creator to approve…", "the board asks for the animatic again…" |
| Motion test on the chosen model before the book (or the creator's waiver) | `flow.mjs bookCheck`, `gen.mjs clip --test`, `launch.mjs waive-test` | "the book waits for a motion test…" |
| Only video models that take a last frame are offered and filmed | `studio.mjs prices`, `gen.mjs clip`, `models.mjs lastFrame` | "rules are model-agnostic…" |
| Frame-by-frame review: verdict answers motion, join, logic, appear, end, after the take sheet and the join sheet | `launch.mjs review`, `launch.mjs build` | "a take review answers…", "a review verdict without answers…" |
| Every edit decision (`retime`, `splice`, `cutOut`, `cleanPatch`) needs the creator's words | `launch.mjs build` | "every edit decision on a take needs the creator's words" |
| `apply` keeps a take whose animation prompt didn't change | `launch.mjs apply` | "apply keeps a take…" |
| Effects ~21 dB under the narration, peaks limited; mix spread ≤ 6 dB; -14 LUFS | `launch.mjs build` | "effects are measured…", editor QC |
| Final QC: frames, voice word for word, text read back, quality report on the exact file | `studio.mjs qc` (`--no-judge` only in the creator's words) | "the final QC needs a quality report…" |
