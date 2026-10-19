# Vertical DNA: UGC product ad (phone-shot creator review)

The ad must not look like an ad. It must look like a real person who found something and can't stop talking about it. **The hook is the priority.**

## What makes it work

- **The first 1.5–3 s decide everything.**
  - Platforms score delivery on early watch time, and early swipes raise costs. ([Stackmatix](https://stackmatix.com/blog/tiktok-creative-best-practices-2026))
  - Open on tension, not on the product. Use one of these:
    - a question
    - a bold problem
    - the most satisfying result
    - a pattern break
- **Native and lo-fi beats polished.** Phone camera, real room, natural light, creator on camera, 9:16, captions in the safe zone. ([tlinky](https://tlinky.com/tiktok-ad-creative-best-practices/))
- **Structure:**
  1. Hook (0–3 s)
  2. Problem
  3. Product as the turn
  4. Proof: demo, result, before/after, specifics like numbers
  5. One CTA
- **Visual hook works muted.** The first frame shows something odd or satisfying even without sound.
- **Volume and testing:** creative is the biggest lever and fatigues fast, so make 4–8 variants per product (hook × format). ([Segwise](https://segwise.ai/blog/tiktok-ad-best-practices-improve-performance))

## Writing rules

- Talk like a friend: contractions, small imperfections, "okay so", "I was today years old".
- One benefit per line. Use real specifics, like "28 g protein, 150 calories", never vague claims.
- Say the product name early and show the label clearly at least twice.
- The CTA uses the brand profile code and link, said once at the end and shown in a caption.
- **Length:** 15–30 s, at 150–180 wpm.

## Formats to rotate

- Talking review
- Green-screen reaction
- Unboxing
- ASMR close-ups
- Podcast-guest mention
- Lifestyle with a mood board
- App screen walkthrough
- Comparison ("me before / after")

## Production settings

- **Brand profile JSON:** product, selling points, audience, code, CTA, banned claims.
- **References:** product shots (front and back), the creator's character sheet and set plate. **Model:** Seedance 2 family (strong product consistency).
- **Resolution:** 720p for this vertical. No broadcast finish; use the "phone" finish.
- **Cheap first pass:** a 5 s test of the hook only, before paying for full length.

## Pacing QC

| Metric | Pass |
|---|---|
| Hook frame + first line make sense muted | yes |
| Product visible by | 3 s |
| Dead air | ≤ 5 % |
| wpm | 150–180 |
| Label legible, no morphing text | yes |
| Exactly one CTA | yes |

## Failure modes

- Loose prompts let the model improvise physics and add unscripted words. Lock the dialogue word for word.
- Slow speech on a long clip reads as AI. Shorten the duration instead.

## Lessons from the landing sample "The Glow Up" (Seedance 2.5, 19 s)

- **Dialogue must sound spoken, not written.** Short fragments ("Two weeks. No filter. Look.") and slogan shapes read as robotic. Write one flowing sentence per shot joined with "and" / "so", the way a friend tells a story.
- **A model without the script improvises, fast.** An improvised take can have a better tone than the written lines, but it ran at almost 380 wpm and dropped the product name. Use improvisation as a writing source, then lock the lines. Budget about 18 words per 8 s (140–150 wpm); if the call to action doesn't fit, make the last shot longer instead of speeding the voice up.
- **Towel and bare shoulders get refused** by some image and video models (the refusal can come back as a generic "Internal Error" and isn't billed). Plan a robe or a top for creators unless the look depends on it.
- **No real brands in a character sheet.** A sheet is a reference for every frame, so a brand in it leaks everywhere. Put the product in the sheet unlabeled.
- **Voices:** stock TTS voices can sound synthetic; `gen.mjs voice-design` from a written description ("natural woman around thirty, relaxed, light vocal fry, phone-mic sound") gives more natural options.
- **Product in hand from the first frame** keeps it steady and consistent across shots.
