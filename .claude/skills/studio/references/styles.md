# Writing a style sheet

A style sheet (`bible/styles/<id>/style.json`) is the contract for how a video looks, moves, sounds and gets judged. Create one per look; reuse it forever.

## Fields
| Field | What to write | Example (hyperreal influencer) |
|---|---|---|
| `kind` | `realistic` (must pass as camera footage) or `stylized` | realistic |
| `look` | The medium in one paragraph: what kind of footage or artwork, camera/film/texture, light, color. Prepended to every image prompt. | "An unretouched frame from a vertical video filmed on a modern phone back camera on a small tripod in a sunlit bedroom…" |
| `imageRules` | Rules every keyframe obeys | "Real skin texture, natural catchlights, five-fingered hands…" |
| `negative` | What the style must never look like | "AI sheen, plastic skin, airbrushing…" |
| `camera` | Lenses, distances, allowed moves (the cinematographer follows it) | "Chest-up, eye-line into the lens, locked or micro-handheld" |
| `motion` | Appended to every motion prompt | "Natural micro-motion: breathing, blinks, small head tilts…" |
| `audio` | `dialogue`: `native` (video model speaks), `talk` (TTS + lip-sync model), `dub`; laugh track; music; sfx | dialogue: talk |
| `characterSheet.prompt` | 2x2 sheet prompt with `{who}`, `{set}`, `{look}` | "four candid phone frames of the same {who} in {set}…" |
| `refPolicy` | `native` (born in the set; realistic) or `sheet` (design sheet; stylized) | native |
| `setRef` | Whether the set plate is passed as a reference | true |
| `finish` | Assembly grade: `broadcast`, `film`, `phone`, `none` | phone |
| `models` | storyboard / keyframe / imageSize / video / res / talk; overwritten by the look-test winner | |
| `candidates` | Models the look test compares | video: wan3-prime, kling3; talk: kling-avatar, infinitetalk |
| `qc.extra` | Style-specific criteria for frames and clips; `minEach`, `minAvg` | `realism`, `lipsync`, `eyeContact` |

## Style-specific QC criteria (add to `qc.extra`)
| Style family | Frame criteria | Clip criteria |
|---|---|---|
| Realistic (any) | `realism`: nothing pasted in; light, texture and scale match the scene | `realism`: no AI sheen or waxy skin; natural micro-motion |
| Talking head / influencer / podcast | `eyeContact`: eye-line where the style says | `lipsync`: lips match words; teeth/tongue plausible; no mouth smear |
| UGC / product | `product`: label text and logo exact and readable | `product` holds through the clip; `authenticity`: phone feel |
| Anime / stylized | `onModel`: matches the model sheet exactly; consistent line weight | `onModel` through motion; no line boil, no drift to 3D |
| Sitcom / multi-cam | `realism` + 180° screen sides | camera stays put; reaction timing |

## Character sheets per style
- Realistic: the 2x2 sheet is shot inside an approved set plate (`cast.mjs sheet <char> --style <id> --set <set>`), so light and texture match the world. The sheet is split into `front`, `threeQuarter`, `profile` and `full`; shots receive only the views their framing needs.
- Stylized: a classic model sheet on a plain background; the views work as on-model references.
- Score every sheet on consistency, anatomy, design, style and layout (`cast.mjs approve`). A rejected sheet gets regenerated with `--note` describing the fix.

## Talking-to-camera styles (influencer, testimonial, clone)
- Write the dialogue word for word; generate the voice first (`gen.mjs voice`), then drive the face with a talk model (`gen.mjs talk` with `kling-avatar` or `infinitetalk`) so the lip-sync follows the exact audio.
- Look-test candidates: the talk models side by side on the same keyframe and audio.
- Keyframe: chest-up, eye-line into the lens, natural background, phone or camera texture per the style.
