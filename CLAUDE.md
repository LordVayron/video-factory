# AI Video Factory

@AGENTS.md

Claude Code specifics:
- The skills in `.claude/skills/` load automatically when Claude Code is opened in this folder. Start with `studio`; first-time users get `onboarding`.
- Publish the Production Book (`projects/<slug>/book/index.html`) as an Artifact when the Artifact tool is available; otherwise open it in the browser for the user.
- Long renders (`gen.mjs scenes`, `gen.mjs loops`, `longform.mjs build` for long videos) can run in the background.
