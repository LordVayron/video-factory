## What this changes

<!-- One or two sentences. The title follows Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`. -->

## Why

<!-- The problem it solves. Link the issue if there is one: "Closes #123". -->

## How it was tested

- [ ] `npm test` passes
- [ ] Tried it on a draft or sample (`--draft`, `--sample`) when it touches generation, editing or the flow

## Checklist

- [ ] Paid calls still go through `engine/gen.mjs` (budget lock, flow gates, ledger)
- [ ] A new rule is enforced in code and has a check in `scripts/`
- [ ] No keys, personal photos, voices, `studio.json` or project files
- [ ] `CHANGELOG.md` updated if users will notice the change
