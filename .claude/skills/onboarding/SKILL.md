---
name: onboarding
description: First-run setup conversation for a new creator of the AI Video Factory. Asks exactly five short questions (what to create, where it will be published, language and tone, own brand/product/characters, budget per video), writes studio.json, creates the first project, and explains how to start other formats in new conversations. Use right after installation, when studio.json does not exist, or when the user says "onboarding", "empecemos", "set me up", "configura la fábrica", "what can I make?".
---

# Onboarding: five questions, then the first project

Goal: in under five minutes, the creator knows what the factory can make, has a `studio.json` profile, and has a first project ready for its script. Speak the user's language (detect it from their first message; Spanish and English are both first-class). Be warm and brief.

## Before the questions
1. Run `npm run doctor`. If anything fails, fix it first (see `SETUP.md`). Keys go in `.env`: ask the user to open `.env` and paste their `KIE_API_TOKEN` and `ELEVENLABS_API_KEY` themselves. Never print a key back, never put one in a command line, a commit or a URL.
2. Then `npm run doctor:online` to confirm both accounts answer.
3. Say in two lines what the factory is: "An AI video studio. I write and direct, Kie.ai renders images and video, ElevenLabs does the voices. You approve two things: the script and the budget. Nothing is spent without your OK."

## The five questions
Ask them **one at a time**, each with numbered options so the user can answer with a number. Accept free text too. Never ask more than five; infer the rest and state your assumptions at the end.

**1. What do you want to create first?**
1. UGC ad for a product (creator-style review, 15–30 s)
2. Micro-drama / vertical novela series for TikTok or Reels (60–120 s episodes)
3. Sitcom or comedy series with recurring characters
4. Fantasy short (epic or cozy)
5. Long meditation, sleep story or ambient video for YouTube (10–120 min)
6. AI influencer or "clone me" talking-head videos
7. Anime short
8. Cinematic short or music-video-style piece
9. Podcast clip
10. Something else (describe it)

**2. Where will it be published?** TikTok · Instagram Reels · YouTube Shorts · YouTube (long) · Ads (Meta/TikTok) · Several. This sets the aspect ratio (9:16 vertical or 16:9) and the length.

**3. Language and tone?** For example "Spanish, funny" or "English, calm and warm". Offer 3–4 tone options that fit the format from question 1.

**4. Do you have your own brand, product or characters?**
1. Yes, I have photos or a logo (ask for the file paths or to drop them in `assets/`)
2. Yes, but only a description
3. No, create original ones for me
For "clone me": only the user's own face and voice, with their consent. Never real public figures, copyrighted characters or brands they don't own.

**5. Budget per video?** Show the typical costs so they can choose:

| Format | Typical cost |
|---|---|
| UGC ad, 15–30 s | $1–3 |
| Micro-drama or sitcom episode, 60 s | $2–5 |
| Fantasy or cinematic short, 30–60 s | $2–6 |
| Meditation or ambient, 30 min | about $2 (the picture loops) |

Kie credits: 1 credit = $0.005. ElevenLabs voices are billed by ElevenLabs in characters.

## After the answers
1. **Write `studio.json`** at the repo root (gitignored), following `templates/studio.json`: language, formats, platforms, aspect ratio, brand or characters, budget, and the creation date.
2. **Create the first project** with the matching command:
   - Long-form meditation or ambient: `node engine/longform.mjs new <slug> --title "..." --minutes N --lang <lang>`, then follow the `format-longform` skill.
   - Series (sitcom, micro-drama, anime series): start the series with the `format-series` skill, then the first episode.
   - Everything else: `node engine/phase.mjs new <slug> --style <style> --title "..." --format <vertical> --lang <lang> --ar <ar>`. Styles: `ugc-phone`, `hyperreal`, `anime`, `podcast`, `retro-sitcom` (or a new one with `style.mjs new`).
   - If they have characters or a product, run the `cast` skill for them first (sheets and voices go in `bible/`).
   - Styles ship as `draft`. The first project in a style needs its look locked once: `node engine/style.mjs northstar <style> "<a scene from their idea>"` (one GPT Image 2.5 frame, about $0.05, ask first), show it, then `node engine/style.mjs approve <style> --northstar <file>`. Every later project in that style reuses it. Long-form projects skip this.
3. **Summarize** in 4–6 lines: what you understood, the assumptions you made, the project you created, and the next step (the script, gate 1). Ask: "Do you want me to write the first script now?"
4. **Tell them how to make other things:** "Every format lives in its own conversation. To make something different (another format, another series, another brand), open a new conversation in this folder and just say what you want, for example: 'hazme un video de meditación de 20 minutos para dormir', 'quiero una novela para TikTok sobre una heredera secreta', 'make a UGC ad for my coffee brand'. I'll read your profile and pick the right pipeline."

## Rules
- Five questions, maximum. No forms, no long explanations.
- Don't spend credits during onboarding. The first paid step happens only after the user approves a script and a budget.
- If the user is in a hurry ("just make something"), pick the format they named, assume the defaults in `templates/studio.json`, and go straight to the script.
