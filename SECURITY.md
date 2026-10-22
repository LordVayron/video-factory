# Security

## Your keys
- Keys live only in `.env` (gitignored) or your environment. The engine never prints them, and the agent instructions forbid putting them in commands, commits, URLs or chat.
- Prefer **scoped keys**: ElevenLabs lets you limit a key to text_to_speech, speech_to_speech, sound_generation and voices_read.
- If a key leaks, rotate it right away in your APIMart, Kie.ai or ElevenLabs dashboard.
- `npm test` scans the repo for token-shaped strings. Run it before you push your own fork.

## Your money
- All paid generation goes through one function (`engine/gen.mjs → job()`), which enforces the budget you approved, counting jobs already in flight.
- Every paid task writes a `.lock` with its task id as soon as it's submitted. If the process dies or times out, the next run collects the result instead of paying again.
- Retries never resubmit after a timeout (the first task may still finish and bill).
- Ledgers and shotlists are written atomically; a corrupt ledger raises an error instead of reading as "nothing spent".

## Your data
- Reference images you use (character sheets, product photos) are uploaded to the provider (APIMart or Kie.ai) and get an unguessable but public URL for 24 to 72 hours. Don't use photos of people without their consent.
- Your characters, series, projects and profile are gitignored by default.

## Reporting a vulnerability
Use GitHub's private vulnerability reporting: the **Security** tab → **Report a vulnerability**. Please don't open a public issue for it.
