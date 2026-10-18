# Contributing

Thanks for helping make the factory better.

- **New format?** Add a playbook to `.claude/skills/studio/references/verticals/` (see [docs/FORMATS.md](docs/FORMATS.md#adding-a-format)) and a row to the studio skill's vertical table.
- **New model?** Add it to `engine/lib/models.mjs` with a request builder and a cost function from Kie's live price feed. All paid calls must go through `gen.mjs → job()` so the budget lock holds.
- **Engine changes:** keep the code plain Node (no framework), run `npm run check`, and test with a draft (`--draft`, `--sample`) before anything paid.
- **Never commit** keys, personal photos, your `studio.json`, or anything from `bible/characters`, `series/` or `projects/`.
- Keep pull requests focused, and describe how you tested them.
