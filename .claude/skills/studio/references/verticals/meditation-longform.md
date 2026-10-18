# Vertical DNA: long-form meditation and ambient (YouTube, podcast apps)

Guided meditations, sleep stories, breathwork, affirmations, yoga nidra, and voice-free ambient or focus loops. They run 10 to 120 minutes. **Nothing may pull the listener out.** The voice, the pauses and the music bed are the product; the picture is a calm window that never asks for attention.

## What makes it work

- **The voice is everything.**
  - Speak slower than conversation: 100–120 words per minute for guidance, 80–100 for deep relaxation and sleep. Normal speech is around 150.
  - Warm, close, low and unhurried, with no "announcer" energy. Sentences end on a falling tone. No upspeak.
  - Second person, present tense, permissive language: "you might notice", "allow", "let". Never commands like "relax now!".
- **Silence is content.** Pauses are where the meditation happens.
  - 3–5 s between instructions, 8–15 s after a breath cue, 20–60 s for "just rest here", and up to several minutes in sleep pieces.
  - A beginner's 10-minute meditation is roughly 40 % voice and 60 % space. Sleep content goes to 20 % voice or less after the first third.
- **Arc, not list:**
  1. Arrival (1–2 min): permission to stop, posture, eyes closed.
  2. Settling (2–4 min): breath, body scan or counting down.
  3. The journey (most of the time): visualization, theme, affirmations or a story.
  4. Integration (1–2 min): what to carry with you.
  5. Return (1 min), or for sleep, **no return**: the voice fades and the music continues.
- **The music never competes.**
  - 60 bpm or no pulse. Pads, soft piano, strings, singing bowls, nature beds. No drums, no vocals, no melody hooks that grab attention, no sudden changes.
  - Sits 15–25 dB under the voice and ducks gently when the voice speaks. During long pauses it carries the space.
  - Binaural beats or solfeggio "frequencies" only if the creator asks. Make no health claims about them.
- **The picture is slow.**
  - 3–6 scenes for a 30-minute piece, each held several minutes, joined by 8–12 s cross-fades.
  - Ambient motion only: mist, water ripples, clouds, candle flicker, snowfall, leaves, stars. The camera never moves fast. Nothing enters or leaves the frame. No faces looking at the viewer.
  - Each scene is a **seamless loop**: the clip's first and last frames are the same still, so the loop point is invisible.
- **Titles and thumbnails do the marketing**, not the video. The first 30 s should already be the experience: no long intro, no "like and subscribe" during the meditation. A soft call to action can go after the return.

## Writing rules

- Short sentences, one idea each. Read aloud, every line should fit in one slow breath.
- Concrete and sensory: weight, temperature, texture, light. "The warm weight of your hands" beats "relaxation".
- Repetition is a feature. Return to the breath every few minutes.
- Use ellipses in the script where you want the voice to slow down, and put real pauses in `pauseAfter`.
- No jokes, no surprises, no cliffhangers, no lists of steps read aloud.
- Safety: do not promise medical outcomes. For breathwork, add "if you feel lightheaded, return to normal breathing". Sleep content says "if you are driving, please stop listening".
- Script density for a planned length: words ≈ minutes × 110 × voice share. For a 20-minute guided piece at 40 % voice, that's about 880 words.

## Formats

| Format | Length | Voice share | Return |
|---|---|---|---|
| Beginner guided meditation | 10–20 min | 40–50 % | yes |
| Body scan / yoga nidra | 20–45 min | 30–40 % | yes or sleep |
| Sleep story | 20–45 min | 50 % first half, then fades | no |
| Breathwork | 5–20 min | 50 % plus counted breaths | yes |
| Affirmations | 10–30 min | 30 % (repeated) | optional |
| Ambient, focus or study loop | 30 min–3 h | 0 % | — |

## Production settings (`engine/longform.mjs`)

- **Project:** `node engine/longform.mjs new <slug> --title "..." --minutes 20 --ar 16:9`. Edit the `longform` block in `shotlist.json`:
  - `scenes[]`: `picture` (still prompt), `motion` (ambient motion prompt, or `"kenburns"` for a free slow zoom), `seconds` (clip length, 8 is a good default), optional `weight` and `period`.
  - `look`: one line shared by every still, so the scenes match.
  - `music`: `prompt`, `tracks` (Suno generations; each returns 2 takes), `db` (bed level, default -20).
  - `voice`: an ElevenLabs `eleven` voice id, `model` (default `eleven_multilingual_v2`), `settings` (default stability 0.75, speed 0.88).
  - `script[]`: `{ text, pauseAfter }` segments, plus `leadIn` (music before the first word, default 20 s) and `tail`.
- **Models:** stills GPT Image 2.5 at 2K; loops Seedance 2 Mini 720p with first frame = last frame (the output is upscaled to 1080p; ambient motion survives it well). Ken Burns costs nothing and is good for interiors and paintings.
- **Output:** 1080p 16:9 H.264 at 24 fps, AAC 192k, plus an MP3 for podcast and meditation apps and a contact sheet. Loudness target -16 LUFS integrated, true peak ≤ -1 dB. YouTube normalizes to about -14, so a meditation sitting a little lower is fine.
- **Cost (30 min, 4 scenes):** 4 stills ~$0.20, 4 loops ~$1.30, music 2 generations ~$0.12. The narration uses ElevenLabs characters. The length barely changes the cost, because the picture loops.
- **Render time:** about 5 minutes per 30 minutes of 1080p on a 12-core PC, since only the loop units and transitions are encoded and the rest is stream-copied.

## Pipeline

1. **Script (gate 1):** arc, segments with pauses, the scene list and the music prompt. Show the estimated length (voice time + pauses).
2. `longform.mjs estimate <slug>` writes the estimate. **Gate 2:** the creator approves it, then `phase.mjs approve <slug> storyboard` locks the budget.
3. `gen.mjs narration <slug>` first, and listen to two segments. A wrong voice is the most expensive mistake to find late.
4. `gen.mjs bed <slug>` and `gen.mjs loops <slug>` (parallel).
5. `longform.mjs build <slug> --sample 90` (a 90-second preview with all layers), then the full `build`.
6. QC (below), then deliver the mp4, mp3, title, description with chapters from `longform.cues`, and a thumbnail still.

## QC

| Check | Pass |
|---|---|
| Voice pace | 100–120 wpm (guidance), 80–100 (sleep) |
| Voice share of runtime | matches the format table |
| Music under the voice | the voice is always clearly intelligible; the bed never pumps |
| Dead air | none (the bed fills every pause) |
| Loudness | -16 ±2 LUFS, true peak ≤ -1 dB |
| Loop seams | invisible (the first and last frame of each unit match) |
| Picture | no fast motion, no faces at camera, no text or logos, no flicker |
| Script | no medical claims; safety lines present where needed |
| Ending | sleep pieces don't wake the listener; others return gently |
