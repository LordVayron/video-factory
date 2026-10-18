# Setup instructions for AI agents

You are an AI coding agent (Claude Code, Codex, or similar) and a user gave you this repository's link to install. Follow these steps in order. Speak the user's language. Don't skip the checks.

## 1. Clone

Clone into a folder the user chooses (default: their home or Documents folder):

```bash
git clone https://github.com/LordVayron/video-factory.git
```

Work from inside `video-factory/` from now on.

## 2. Install the tools

Required: **Node.js 22+**, **ffmpeg + ffprobe**, **Python 3.10+**. Check each with `--version`. If something is missing, install it with the platform's package manager and tell the user what you're installing:

| Tool | Windows (winget) | macOS (brew) | Linux (apt) |
|---|---|---|---|
| Node.js | `winget install OpenJS.NodeJS.LTS` | `brew install node` | `sudo apt install nodejs npm` |
| ffmpeg | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `sudo apt install ffmpeg` |
| Python | `winget install Python.Python.3.12` | `brew install python` | `sudo apt install python3 python3-pip` |

On Windows, open a new terminal after a winget install so PATH updates. Or run the one-shot script, which does all of this:

- Windows: `powershell -ExecutionPolicy Bypass -File scripts/setup.ps1`
- macOS / Linux: `bash scripts/setup.sh`

## 3. Install the packages

```bash
npm ci
```

```bash
python -m pip install -r requirements.txt
```

(Use `python3` on macOS and Linux.) faster-whisper downloads a ~150 MB model on first use.

## 4. Keys

The factory needs two accounts:

| Key | Where | Used for |
|---|---|---|
| `KIE_API_TOKEN` | https://kie.ai/api-key | images, video, music, the vision judge |
| `ELEVENLABS_API_KEY` | https://elevenlabs.io/app/settings/api-keys | voices, voice conversion, sound effects |

Copy `.env.example` to `.env` and ask the user to open `.env` and paste both keys **themselves**. Don't ask them to paste keys into the chat. Never print a key, never put one in a command, a commit or a URL. `.env` is gitignored.

## 5. Check

```bash
npm run doctor
```

```bash
npm run doctor:online
```

Everything should say `ok`. A `warn` about ElevenLabs `user_read` is fine (the key works; only the quota display is off).

## 6. Onboarding

Read `.claude/skills/onboarding/SKILL.md` and follow it: five short questions, then a `studio.json` profile and the first project. If your agent loads skills only at startup, read the skill file directly now and tell the user that next time they can open a new session inside `video-factory/` and the skills load automatically.

## Where things are

- `AGENTS.md` / `CLAUDE.md`: the house rules for any agent working here.
- `.claude/skills/*/SKILL.md`: the skills (studio is the entry point; onboarding, story-architect, cinematographer, cast, format-series, format-longform).
- `.claude/skills/studio/references/`: the knowledge base (vertical DNA files, QC, styles, writing guides).
- `engine/`: the Node CLIs. `docs/ARCHITECTURE.md` explains them.
