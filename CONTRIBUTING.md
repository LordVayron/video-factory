# Contributing

Thanks for helping make the factory better. Bug reports, new formats, new models and fixes are all welcome.

## Before you start

- **Bugs and ideas:** open an issue with the templates (Issues → New issue). For anything bigger than a small fix, open an issue first so we can agree on the approach before you write code.
- **Security problems:** don't open a public issue; follow [SECURITY.md](SECURITY.md).

## Set up

```bash
git clone https://github.com/<your-user>/video-factory.git   # your fork
cd video-factory
npm run setup     # Node packages, Python requirements, then the doctor
npm test          # offline checks: no keys, no paid calls
```

You need Node 22+, Python 3.10+ and ffmpeg (see [docs/INSTALL.md](docs/INSTALL.md)). The checks never call a paid API, so they run without any keys.

## Making a change

1. Fork the repo and create a branch from `main` (`fix/short-name` or `feat/short-name`).
2. Make the change and run `npm test`. GitHub runs the same checks on your pull request.
3. Open a pull request with the template filled in. The title follows [Conventional Commits](https://www.conventionalcommits.org/): `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, `ci: ...`, `chore: ...`.
4. Keep pull requests focused: one change per PR is easier to review and to roll back.

## Where things go

- **A new format:** a playbook in `.claude/skills/studio/references/verticals/` (see [docs/FORMATS.md](docs/FORMATS.md#adding-a-format)) and a row in the studio skill's vertical table.
- **A new model:** an entry in `engine/lib/models.mjs` with its request builder and cost function, priced from the providers' live prices. Every paid call goes through `engine/gen.mjs` (`job()`), so the budget lock, the flow gates and the ledger hold.
- **A new rule or safeguard:** enforce it in code, not only in the docs, and add a check under `scripts/` that fails without it.
- **Engine code:** plain Node, no framework. Test with a draft or a sample (`--draft`, `--sample`) before anything paid.

## Never commit

API keys or `.env`, personal photos or voices, your `studio.json`, or anything from `bible/characters/`, `series/` or `projects/`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
