# Changelog

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
