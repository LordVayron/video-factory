# Storytelling for short AI video

## 1. Retention mechanics (all formats)
- **Hook in 0–1.5s.** A visual pattern interrupt (something that shouldn't be there, mid-action, an extreme close-up, a sound) plus an *open loop*: a question the viewer needs answered. Examples: a dog bursting in with "I've got the big idea!"; a product being destroyed; a line like "I got fired for this."
- **Re-hook every 5–8s.** Each beat changes something: new info, a reversal, an escalation, a cut to a reaction.
- **But / Therefore** (Parker & Stone). If beats join with "and then", it's a list, not a story. Rewrite until each beat causes the next or reverses it.
- **Payoff before the drop-off.** Deliver the promise of the hook by about 70% of the runtime, then a button.
- **Loopable endings** (Shorts/Reels): the last frame or line should flow back into the first.
- **Sound carries comedy.** Silence after a line, then the reaction shot, is the funniest cut in a sitcom.

## 2. Sitcom engine (format: sitcom)
- **Characters = one exaggerated trait + one flaw.** Pair a *straight man* (grounded, reacts) with an *eccentric* (drives chaos). A deadpan CEO cat vs an eager intern dog.
- **Episode shape for 30–90s:**
  1. Cold open: the eccentric enters with a want or a problem (hook).
  2. Setup: the straight man shuts it down.
  3. Escalation 1 → 2 (rule of three: normal, normal, absurd).
  4. Twist: the straight man is won over, or the plan backfires.
  5. Disaster or reversal.
  6. Button: a callback, a tiny line, a look into the lens.
- **Running gags across episodes** (a prop, a drink, a name said three different ways) build a series. Note them in `bible/characters/*/character.json` under `traits`.
- **Callbacks** pay off something from the first 10 seconds in the last 5.
- **Joke construction:** setup → pause → punch. Put the funniest word last. Cut on the reaction, not the line.
- Keep 1 set and 2–3 characters per episode. It's cheaper and more consistent, and a fixed set is a sitcom convention anyway.

## 3. Story Circle (format: cinematic, longer pieces)
Dan Harmon's 8 steps compressed for 60–120s: 1. a character in a zone of comfort, 2. wants something, 3. enters an unfamiliar situation, 4. adapts, 5. gets what they wanted, 6. pays a heavy price, 7. returns, 8. having changed. For 30s pieces use 1→3→6→8.

## 4. Ads and UGC (format: ugc-ad)
- **Beats:** Hook (0–2s) → Problem (2–6s) → Reveal of the product (6–9s) → Demo/proof (9–18s) → CTA (last 2–3s).
- **Hook types that work:** a call-out ("If you have curly hair, stop scrolling"), a confession ("I was wrong about…"), a result first ("This took me from X to Y"), a negative ("Don't buy X until…"), a demo shock (visible effect in frame 1).
- **UGC grammar:** handheld selfie framing, natural room light, talking to the lens, small imperfections (a glance away, "honestly", a laugh), the product in hand by second 6.
- One claim per ad. Proof beats adjectives: show the texture, the before and after, the timer.
- The CTA tells them exactly what to do and why now.

## 5. Influencer / "clone me" (format: influencer)
- Talking-head structure: hook line → 3 punchy points (each with a visual change: angle, B-roll or zoom) → takeaway → CTA.
- Vary the framing every 3–5s (punch-in 110–120% in the edit is free).
- Write how the person actually talks; use their real catchphrases.

## 6. Dialogue rules for AI video
- ≤ 12 words per line, one line per shot (two short lines max for a two-shot).
- Write delivery notes (`"delivery": "flat, tired"`). They go into the motion prompt and change the performance.
- ElevenLabs v3 audio tags work in the voice pass: `[sighs]`, `[laughs]`, `[whispers]`, `[excited]`. Put them in `tags`, not in the caption text.
- Avoid names and words that are hard to pronounce; spell them phonetically in `text` if needed.

## 7. Checklist before handing off
- [ ] A hook that works with the sound off, in the first 1.5s.
- [ ] Every beat joins with "but" or "therefore".
- [ ] One want, one obstacle, one twist.
- [ ] Lines ≤ 12 words; each fits its shot length.
- [ ] Ends on a button or CTA; ideally it loops.
- [ ] The cast and set already exist in `bible/` (or are listed to be created).
- [ ] Runtime = sum of shot durations, within the target.
