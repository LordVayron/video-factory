# Changelog

## 2.5.0, 2026-10-20: universal guided meditations

Guided meditation videos for YouTube: a voice-over, a soundtrack and a looping image that shows the meditation's premise. Shipped as the landing's *Midnight Lake* preview.

- **One engine, any intention.** `engine/lib/meditation.mjs` defines sleep, anxiety, higher self, manifestation, morning, self-love, breathwork and focus. Each intention sets the voice pace, pauses, voice share, music tempo, picture, ending and safety line. The script gate refuses a meditation without an intention and a premise, or a scene that doesn't show the premise. It also refuses faces or text in the picture, fast motion, off-tempo music, music with drums or vocals, and pauses that are too short.
- **Bring your own material.** `longform.mjs script <slug> --file meditation.txt` keeps a written meditation word for word: it is split into breaths, and a blank line or `[pause 12]` sets the pauses. `longform.mjs image <slug> --file picture.png` animates your own picture. The music, voice, mix and loop are made for you.
- **Voice pace that fits.** "..." in the script becomes a real breath break (longer for sleep), and the build measures the recorded voice against the intention.
- **Loops that move.** Loops start from the still only, because asking for the same first and last frame froze the motion. Every loop's motion is measured, and a frozen one stops the build (**LOOP STATIC**).
- **Demo mode** (15–30 s previews: voice by 1.5 s, short fades). **Dark screen** after N minutes for pieces that fade out. A **YouTube package** (`-youtube.md`) with a literal title, chapters and the AI note.
- Build outputs no longer reopen an approved book; `studio.mjs new` turns a meditation of 30 s or less into a demo.
- Landing: a wide CRT player for 16:9 tapes.

## 2.4.0, 2026-10-20: micro-dramas that hold together

Everything learned shipping the landing's micro-drama sample, *Not the Father*, is now a gate or a check in code.

- **Coverage angles.** Anyone with close-ups in more than one scene gets one locked angle frame (`gen.mjs angles <slug>`) before the storyboards: the exact framing and background of all their close-ups. The board step refuses missing angles, or grids drawn before them; every storyboard and scene with that person's close-up gets the angle as a reference.
- **Backgrounds across the whole film.** `studio.mjs qc` compares every close-up's background across scenes and fails a different wall, window or set dressing behind the same person. Inside a take, a fixed-camera shot whose background changes fails continuity, and a drift only in a silent tail is trimmed and judged again automatically.
- **Speaking rate per model.** Every cut records the video model's measured words per minute (`engine/data/speech-rates.json`). `studio.mjs prices` shows it and won't recommend a model measured over 175 wpm for a speaking format; `approve-pilot` stops on a fast pilot unless the creator accepts the rate (`--ok-fast`).
- **Radio cut.** A read that is too fast re-voices itself slower at the source (ElevenLabs speed, multilingual v2), step by step; tempo under 0.85 is refused (it sounds like slow motion); silent reactions keep their planned length on reruns; the length range follows the intake.
- **VOICE REF STOP.** A voice sample that speaks a line of the script is refused: the video model repeats what it hears.
- **Drama rules** before the book (bright light, two people per shot, no hand-object beats, hook by 3 s, short shots and reactions, eye-level dialogue, 25-90 s), a look-test gate at casting, structured JSON specs per shot, native lip-synced voices by default outside the sitcom.
- A passing continuity take becomes the scene's chosen take; a QC score no longer reopens an approved book.

## 2.3.0, 2026-10-19: pilot gate and format readiness

- **Pilot gate:** after the Production Book only the first scene or shot can be filmed; the creator watches it and approves it in their words (`studio.mjs approve-pilot <slug> --said "..."`) before the rest is filmed. A bad pilot costs one scene, not the episode.
- **Format readiness:** micro-drama, anime, cinematic and fantasy stop at the price step until the editor can score them (music, stings, swell). No spend on a video the engine can't finish.
- Scenes send each character's face and full-body views, so wardrobe holds when a scene opens on someone else.
- The book estimates only what is still to film; the dialogue check spells heard numbers ("400" = "four hundred"); the edit keeps a drama's pauses and applies laugh rules only to the sitcom; the radio cut has drama pacing rules.
- New series take their format's style; `accept-take` works for scenes; `cast.mjs plate` reads its description in any position; `studio.mjs status` never crashes on a missing character.

## 2.2.0, 2026-10-19: the script always reaches the model

- **Dialogue word for word, enforced.** `gen.mjs clip` used to send only the shot's visual prompt, so the video model never got the script and improvised. Now every clip prompt is the shot's prompt plus every line verbatim at a calm natural pace (140-160 wpm), and `job()` refuses any speaking video job whose prompt leaves out a line or doesn't declare its lines (**DIALOGUE STOP**). The Production Book shows the exact prompt the model receives.
- A paid take is recorded before its evals run; if an eval can't run, `gen.mjs clip <slug> --shot <id> --eval <n>` re-runs them for free.
- `"frame": "@A:last"` reads the real last video frame, also when the audio runs longer than the video.
- `gen.mjs voice-design <char> "<description>"` and `voice-pick <char> <n>`: design a new ElevenLabs voice from a description and keep one.
- `phase.mjs budget --usd <dollars>` (`--add` is in credits); `studio.mjs status` no longer crashes when a cast member isn't in the bible yet.

## 2.1.0, 2026-10-19: live price analysis

- **`studio.mjs prices`**, a new flow step right before every Production Book: every video model the engine can run is priced from Kie's live feed for the project's length and resolution, ranked by quality, filtered by what the format needs (multi-shot scenes, first/last-frame clips, loops), and the best quality that fits the budget becomes the project's model. Models Kie sells that the engine doesn't run yet are listed.
- **No model is excluded by rule** (Veo is offered like any other).
- The book's estimate and the film now use the same model (the estimate used to fall back to the style's default).
- The guard hook no longer mistakes read-only commands next to inline code for API calls.


## 2.0.0, 2026-10-19: flow v5

- **One enforced path for every format:** `engine/studio.mjs` starts every project with a 7-question intake and moves it only through its recipe (scenes, clips or long-form). Every engine command checks its step; approvals are recorded in the user's words and reopen when what was approved changes. No `--force`, no legacy bypass, drafts are never deliverable.
- **Identity eval:** faces and distinctive marks (freckles, moles, glasses, earrings) on every take and across every cut, compared side by side with a locked face anchor. Prompts that drop a character's marks are refused.
- **Jump check:** cuts or snaps inside a single generated shot are caught; end snaps are trimmed.
- **Clips formats** (AI influencer, UGC, cinematic, podcast, fantasy): `gen.mjs frame`, `gen.mjs clip --shot` with per-take evals, and `cut.mjs`, a plain editor with re-voice and loudness.
- **Final QC and delivery receipt:** `studio.mjs qc` fingerprints the file that passed; `studio.mjs deliver` writes the receipt and the final Production Book, now built for every format.
- **Guard hook** for Claude Code: blocks one-off scripts that call paid APIs and videos sent without a receipt.
- **Engine fixes** from production: radio-cut pacing counts silent action beats, per-scene sets and time jumps in the continuity plan.


## 1.0.0, 2026-10-17: first public release

- **Agent install and onboarding:** give the repo link to Claude Code or Codex; `SETUP.md` guides the install, and the `onboarding` skill asks five questions and creates your `studio.json` profile and first project.
- **Pipeline v4:** writers' room script (gate 1), audio-first radio cut, GPT Image 2.5 storyboard grids, Production Book with a locked budget (gate 2), one multi-shot generation per scene, vision-judge continuity eval, auto edit with unified voices, captions, laughs or music, and QC.
- **Long-form ambient** (`engine/longform.mjs`): meditation, sleep and focus videos from 10 minutes to 3 hours, with seamless loop scenes, a music bed under a paced voice-over, 1080p + MP3; 30 minutes renders in about 5.
- **Playbooks:** UGC ad, micro-drama, 90s sitcom (plus a writing bible), fantasy short, meditation and long-form, AI influencer, anime, cinematic, podcast clip.
- **Safeguards:** budget lock that counts in-flight jobs, crash and timeout recovery without double-paying, atomic ledgers, offline checks and a secret scan.
