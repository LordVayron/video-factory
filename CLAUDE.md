# AI Video Factory

@AGENTS.md

Claude Code specifics:
- The skills in `.claude/skills/` load automatically when Claude Code is opened in this folder. Start with `studio`; first-time users get `onboarding`.
- Publish the Production Book (`projects/<slug>/book/index.html`) as an Artifact when the Artifact tool is available; otherwise open it in the browser for the user.
- The guard hook in `.claude/settings.json` runs before every tool call: it denies one-off scripts that call Kie or ElevenLabs and videos sent without a delivery receipt. If it stops you, use the engine command it names; never work around it.
- Long renders (`gen.mjs scenes`, `gen.mjs loops`, `longform.mjs build` for long videos) can run in the background.
