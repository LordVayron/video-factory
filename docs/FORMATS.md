# Formats and costs

Every format has a playbook in `.claude/skills/studio/references/verticals/`. Your agent reads it before writing a single line. Costs are Kie.ai credits at the default models (check live prices with `npm run prices`); ElevenLabs voices are billed separately in characters.

| Format | Playbook | Skill | Default models | Output | Typical cost |
|---|---|---|---|---|---|
| UGC product ad | `ugc-ad.md` | `studio` | GPT Image 2.5, Seedance 2 Mini 720p | 15–30 s, 9:16 | $1–3 |
| Micro-drama / vertical novela | `micro-drama.md` | `format-series` | GPT Image 2.5, Seedance 2 family 720p | 60–120 s episodes, 9:16 | $2–5 per episode |
| 90s sitcom / comedy series | `sitcom-90s.md`, `sitcom-writing-bible.md` | `format-series` | GPT Image 2.5, Seedance 2 Mini 480p (broadcast finish) | 40–60 s episodes | $2–5 per episode |
| Fantasy short | `fantasy-short.md` | `studio` | GPT Image 2.5 2K, Seedance 2 family 720p | 30–90 s | $2–6 |
| Meditation, sleep, ambient, focus | `meditation-longform.md` | `format-longform` | GPT Image 2.5 2K, Seedance 2 Mini 720p loops, Suno | 10 min – 3 h, 1080p 16:9 + MP3 | ~$2 for 30 min |
| AI influencer / clone me | `influencer-talking-head.md` | `studio`, `cast` | GPT Image 2.5, talking-head models | 15–60 s | $1–4 |
| Anime short | `anime-short.md` | `studio` | GPT Image 2.5, Seedance 2 Mini | 20–40 s | $1–3 |
| Cinematic / hyperreal | `cinematic-hyperreal.md` | `studio` | GPT Image 2.5, Seedance 2 family 720p | 15–60 s | $2–5 |
| Podcast clip | `podcast-clip.md` | `studio` | talking-head or real footage | 30–60 s | $1–3 |

## Where the money goes

- **Images:** GPT Image 2.5 at $0.03 (1K), $0.05 (2K) or $0.08 (4K) each. A storyboard grid for a whole scene is one image.
- **Video:** charged per second. Seedance 2 Mini is about $0.019/s at 480p and $0.041/s at 720p.
- **Music:** Suno, about $0.06 per generation (two takes).
- **Drafts are free:** the script, the radio cut, the animatic and long-form previews cost nothing in Kie credits.

## Adding a format

Write a new playbook in `verticals/` with: research (what makes it great, with sources) → structure → writing rules → picture → sound → pacing numbers → QC → failure modes. Add a row to the studio skill's vertical table. Every finished video's lessons go back into its playbook.
