# Vertical DNA: guided meditation videos (YouTube, podcast apps)

**What we make:** guided meditations for YouTube with three layers.
- A **voice-over** that guides.
- A **soundtrack** under it.
- A **looping image** that shows the meditation's premise.

They run 10 to 120 minutes. Previews and demos run 15–30 s.

**It is universal.** Sleep is one intention among many: anxiety relief, finding yourself or talking to your higher self, manifestation, morning energy, self-love, breathwork and focus all use the same engine. The intention only changes the numbers (table below, enforced by `engine/lib/meditation.mjs`).

**Nothing may pull the listener out.** The voice, the pauses and the soundtrack are the product. The picture is a calm window that never asks for attention.

## The premise drives everything

- Every meditation has a **premise**: one sentence of what happens to the listener. For example: "Rain on a cabin window washes the day away"; "you climb a stair of light to meet the person you are becoming"; "the sun rises and you choose one intention for the day".
- **Every image shows a part of that premise** (`longform.premise`, and `premiseLink` per scene). A picture is never generic "calm stock".
- The image **loops in the background**: one steady, slow motion that has no start and no end (rain, mist, light rays, stars, water, candle flame, drifting clouds).
- The music's mood and the words come from the same premise. If the voice says "the garden", the picture is that garden.

## What the creator can hand us (any mix of these)

| The creator gives | We make | Engine |
|---|---|---|
| **An idea** ("a meditation to talk to my higher self") | premise, intention, script, picture, motion, music, voice | intake `--start idea`; the script gate checks everything |
| **The whole meditation, written** | kept **word for word**; we only split it into breaths and add pauses, plus picture, music and voice | `longform.mjs script <slug> --file meditation.txt`. A blank line means a longer pause, `[pause 12]` means 12 s. The gate refuses any change to their words |
| **The image** | we animate it into the loop (one slow motion), plus the rest | `longform.mjs image <slug> --file picture.png [--scene A]`. Their image is not linted: it is their call |
| Nothing ("from scratch") | everything, starting from three concepts to choose from | intake `--start scratch` |

Whatever they hand us, **the music and the rest are always ours**: the soundtrack, the voice, the mix, the loop, the YouTube package. Their text is never rewritten and their picture is never redrawn without asking.

**Demos and previews:** the voice of the guided meditation must be heard from the first seconds. A demo that is only music and a picture doesn't show the product.

## Intentions (the engine's profiles; the script gate enforces them)

| Intention (`intent`) | Technique | Voice wpm | Pauses | Voice share | Music | Picture | Ending | Safety line |
|---|---|---|---|---|---|---|---|---|
| `sleep` | release-only body scan, slow countdown, plot-free visualization; boring on purpose | 80–100 | 6–20 s | 20–45 % | 60–72 bpm | night or blue hour, dark low contrast; optional dark screen after N min | fades out, no return | "If you are driving, please stop listening." |
| `anxiety` | long-exhale or box breathing, grounding through touch and the senses (5-4-3-2-1), naming without judging | 95–120 | 4–12 s | 35–55 % | 60–75 bpm | soft daylight or overcast nature, water, open sky | gentle return | permission to stop at any time |
| `higher-self` | settle → go inward along a path (stairs, door, garden, temple of light) → meet a wise presence or your future self → receive a word or an image → bring it back | 90–115 | 6–18 s | 35–50 % | 60–72 bpm | luminous sanctuary, light rays, cosmic sky; awe without spectacle | return | none; present it as imagination, not fact |
| `manifestation` | present-tense "I am" affirmations with room to repeat them; a vivid picture of the life wished for | 100–125 | 3–10 s | 35–55 % | 65–85 bpm | golden hour, sunrise, open horizon | return | none; promise no outcomes |
| `morning` | posture and breath, gratitude, one intention for the day, eyes open at the end | 110–135 | 3–8 s | 45–65 % | 70–95 bpm | sunrise, fresh bright light | return, alert | none |
| `self-love` | heart-centred breathing, loving-kindness phrases, warmth spreading | 90–115 | 5–14 s | 35–50 % | 60–75 bpm | warm soft light, flowers, candle glow | return | "You can pause at any time." |
| `breathwork` | counted breaths (box 4-4-4-4, long exhale 4-6), rest between rounds | 95–120 | 4–16 s | 40–60 % | 60–75 bpm | steady and spacious: horizon, still water | return | "If you feel lightheaded, return to your normal breath." |
| `focus` | a short spoken settle-in, then music and the image carry it | 100–125 | 3–12 s | 0–15 % | 60–90 bpm | calm desk, library, rain on glass | return | none |

**Sources for the non-sleep intentions** (practitioner guides, not trials):
- Anxiety: box breathing and 5-4-3-2-1 grounding. ([therapist.com](https://therapist.com/disorders/anxiety/grounding-techniques-for-anxiety/), [UMass mindfulness](https://www.ummhealth.org/services-treatments/center-mindfulness/guided-meditations))
- Higher self / inner guide: settle, go inward, meet the guide, receive, return. ([Mindfulness Exercises](https://mindfulnessexercises.com/higher-self-meditation), [Guided Imagery Downloads](https://guidedimagerydownloads.com/?p=1987))
- Morning: grounding, gratitude, intention, present-tense affirmations. ([Livestrong](https://livestrong.com/article/13726502-5-minute-morning-meditation), [Life Coach Magazine](https://www.lifecoachmagazine.com/morning-meditation-script/))
- Popular categories on YouTube: sleep, then anxiety and stress, then affirmations and mindset. ([Declutter The Mind](https://declutterthemind.com/blog/best-meditation-youtube-channels), [Choosing Therapy](https://www.choosingtherapy.com/meditation-youtube-channels/))

## What makes it work (every intention)

- **The voice is everything.**
  - Speak slower than conversation, at the intention's pace (table above): from 80–100 words per minute for sleep to 110–135 for a morning piece. Normal speech is around 150.
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
  - 60–80 bpm (the intention sets the range) or no pulse. Pads, soft piano, strings, singing bowls, nature beds. No drums, no vocals, no melody hooks that grab attention, no sudden changes.
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

## Research update (2026-10-20): the sleep intention and YouTube in general

What the research adds or corrects. Practitioner sources disagree on exact numbers and none is peer reviewed, except the music evidence.
- **Music: 60–80 bpm, not exactly 60.** A 2025 narrative review in Frontiers in Sleep found the music that helps sleep is slow (60–80 bpm), soft and smooth, instrumental and simply structured, usually classical or new age. A 2014 randomized trial of older adults used the same profile and improved sleep quality. Binaural beats and "brain-wave" music are unproven: no health claims. ([review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12713922/), [Frontiers](https://www.frontiersin.org/journals/sleep/articles/10.3389/frsle.2025.1707162/abstract))
- **Voice:**
  - About two-thirds of normal speaking speed, a slightly lower pitch and even volume.
  - Sleep narration runs about 90 wpm; audiobooks run 150–180.
  - Every sentence lands on a falling tone, with no dramatic shifts in volume or emotion. ([Pabau](https://pabau.com/templates/5-minute-meditation-script/), [StillMind](https://getstillmind.com/blog/meditation-scripts-for-sleep/), [Mattress Miracle](https://mattressmiracle.ca/blogs/mattress-miracle-blog/best-voice-acting-music))
- **Pauses:** 3–5 s in general guidance, 8–20 s in bedtime scripts.
- **Word count:** a 10-minute sleep script can be as little as 120–250 spoken words, mostly silence. ([Hilite](https://www.hellohilite.com/learn/guides/how-many-words-is-a-10-minute-guided-meditation), [Mindful](https://mindful.net/mindfulness-exercises/short-guided-meditation-scripts))
- **Sleep content is boring on purpose:**
  - Calm tells its sleep-story writers to drop conflict, tension and twists.
  - Too dull and the worries come back; too gripping and nobody sleeps.
  - Description over plot, present tense, recurring patterns (counting, circular routes).
  - Body scans release only, without tensing, and the piece fades out instead of calling the listener back.
- **The picture:**
  - Viewers split between gentle visuals and black screens. Big sleep channels publish both, or show a calm visual first and then a **black screen after N minutes**, so the room stays dark.
  - Loops come from steady-motion prompts (steady drizzle, drifting mist, not a start and a stop), with the seam hidden in the edit. ([Kling](https://kling.ai/topics/ai-rain-video), [SheKnows](https://www.sheknows.com/health-and-wellness/articles/2237386/deep-sleep-dark-screen-music-videos-for-sleep/))
- **Titles, thumbnails, channel:**
  - Literal, search-shaped titles ("Guided sleep meditation for anxiety, 30 min, dark screen"), not poetic ones.
  - Simple calm thumbnails (one icon or scene, blues and purples), timestamps, and playlists by length and purpose. ([Fluxnote](https://fluxnote.io/guides/how-to-make-sleep-sounds-youtube-channel-ai), [Fluxnote 2026](https://fluxnote.io/guides/youtube-meditation-channel-2026))
- **YouTube policy:**
  - Since July 2025 the monetization rule is called "inauthentic content": mass-produced, near-identical uploads (e.g. the same narrated slideshow with small changes) don't earn.
  - AI tools are fine when each video adds original value, and realistic synthetic content must be disclosed. Every video needs its own script, picture and music, never a re-skin. ([Social Samosa](https://www.socialsamosa.com/news-2/youtube-clarifies-monetisation-policy-targeting-inauthentic-content-9493155), [eWeek](https://www.eweek.com/news/youtube-responds-to-ai-concerns/))
- **Short previews (Shorts, trailers, the landing demo):**
  - The first 3 seconds decide the view, so the experience must start at once: no long music intro.
  - One concrete promise, then a link to the long video.
  - Expect a small overlap between Shorts viewers and long-form sleepers. ([Subscribr](https://subscribr.ai/youtube-strategy/drive-traffic-shorts-to-long-videos))

## Demo or preview cut (15–30 s)

- **Structure:**
  - 0–2 s: picture and music already there, faded in over 1–2 s, not 20.
  - The first line by ~2 s.
  - 2–4 short lines at ~90–100 wpm, with 2–4 s of music between them.
  - Hold the picture under the music for the last 3–5 s, then a slow fade.
- **Length budget:** about 20–30 spoken words for 25 s. One or two loop scenes; one is enough.
- **Picture:** one scene that reads in a thumbnail-sized glance, with one gentle motion (mist, rain on glass, falling snow, stars).
- **Ratio:** 16:9 for YouTube; a 9:16 version for Shorts is a separate render.

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
  - `intent` (one of the table's intentions) and `premise` (one sentence). The script gate refuses a project without them, or one that breaks the intention's pace, pauses, music tempo, picture or safety rules.
  - `demo: true` + `seconds` (15–30): a preview with a 1.5 s lead-in and short fades.
  - `darkAfter` (minutes, only for intentions that fade out, like sleep): the picture fades to black and stays black while the sound carries on.
  - The build measures the recorded voice's wpm against the intention, and writes `out/<slug>-youtube.md` with a literal title, chapters and the AI note.
  - `scenes[]`: `picture` (still prompt; no people, faces or text), `premiseLink` (which part of the premise it shows), `motion` (one slow steady ambient motion, or `"kenburns"` for a free slow zoom), `seconds` (clip length, 8 is a good default), optional `weight` and `period`.
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
2. `longform.mjs estimate <slug>` writes the estimate. Then `book.mjs <slug>`. **Gate 2:** the creator approves the book, then `studio.mjs approve <slug> book --said "..."` locks the budget.
3. `gen.mjs narration <slug>` first, and listen to two segments. A wrong voice is the most expensive mistake to find late.
4. `gen.mjs bed <slug>` and `gen.mjs loops <slug>` (parallel).
5. `longform.mjs build <slug> --sample 90` (a 90-second preview with all layers), then the full `build`.
6. QC (below), then deliver the mp4, mp3, title, description with chapters from `longform.cues`, and a thumbnail still.

## QC

| Check | Pass |
|---|---|
| Voice pace | the intention's range (measured by the build) |
| Voice share of runtime | matches the format table |
| Music under the voice | the voice is always clearly intelligible; the bed never pumps |
| Dead air | none (the bed fills every pause) |
| Loudness | -16 ±2 LUFS, true peak ≤ -1 dB |
| Loop seams | invisible (the first and last frame of each unit match) |
| Picture | no fast motion, no faces at camera, no text or logos, no flicker |
| Script | no medical claims; safety lines present where needed |
| Ending | sleep pieces don't wake the listener; others return gently |
