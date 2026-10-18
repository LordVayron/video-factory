# Manual install

The easy way is to ask your agent: *"Install https://github.com/LordVayron/video-factory and set it up for me."* It follows [`SETUP.md`](../SETUP.md). This page is for doing it yourself.

## Requirements

| Tool | Version | Used for |
|---|---|---|
| Node.js | 22+ | the engine |
| ffmpeg and ffprobe | 6+ | editing, QC, contact sheets, long-form renders |
| Python | 3.10+ | whisper alignment, pitch analysis, panel trims |
| A coding agent | Claude Code or Codex | the director: writes, plans and runs the engine |

Python packages are in `requirements.txt` (numpy, faster-whisper, Pillow, pypdf). faster-whisper runs on the CPU and downloads a ~150 MB model on first use.

## Steps

```bash
git clone https://github.com/LordVayron/video-factory.git
```

```bash
cd video-factory
```

Windows (installs missing tools with winget):

```bash
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

macOS / Linux:

```bash
bash scripts/setup.sh
```

Or by hand:

```bash
npm ci
```

```bash
python -m pip install -r requirements.txt
```

## Keys

Copy `.env.example` to `.env` and fill in:

| Key | Where | Notes |
|---|---|---|
| `KIE_API_TOKEN` | https://kie.ai/api-key | Images, video, music and the vision judge. Pay as you go: 1 credit = $0.005. |
| `ELEVENLABS_API_KEY` | https://elevenlabs.io/app/settings/api-keys | Voices, speech-to-speech, sound effects. Billed by ElevenLabs in characters. For commercial use, check that your ElevenLabs plan allows it. A scoped key needs text_to_speech, speech_to_speech, sound_generation and voices_read; add user_read if you want the doctor to show your quota. |

Real environment variables override `.env`. Never commit `.env` (it's gitignored).

## Check

```bash
npm run doctor:online
```

Then open your agent in the folder and say *"onboarding"* (or just describe the video you want).

## Your work stays local

`bible/characters`, `bible/sets`, `bible/sfx`, `series/`, `projects/`, `assets/` and `studio.json` are gitignored, so pulling updates never touches your characters, shows or videos, and you can't push them by accident. Back them up however you like (an external drive, or your own private repo).

## Updating

```bash
git pull
```

```bash
npm ci
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No Kie key` | `.env` is missing or empty. |
| `ElevenLabs 401 ... missing the permission` | The key is scoped. Add the permission the message names. |
| `ffmpeg not on PATH` | Install it, then open a new terminal. |
| `BUDGET STOP` | Working as intended: the approved budget is used up. Approve more with `node engine/phase.mjs budget <slug> --add N --said "..."` only if you want to spend it. |
| `ALTO: ...` | Working as intended: a step of the flow is missing. Run `node engine/studio.mjs status <slug>` and do the step it names. |
| A `.lock` file stays in `clips/` or `loops/` | A paid task is still running or wasn't downloaded. The next `gen.mjs` run recovers it instead of paying again. Don't delete it. |
| `corrupt JSON in projects/...` | A shotlist or ledger was damaged. The engine refuses to overwrite it. Restore it from your backup. |
| Whisper is slow | It runs on the CPU. Short videos take seconds; it's only used for alignment and QC. |
