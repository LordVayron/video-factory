# Which Kie model for which job

Prices are from Kie's live price feed on 2026-10-08 (1 credit = $0.005). Refresh with `node engine/gen.mjs prices`.
Engine keys are in `engine/lib/models.mjs` (`node engine/gen.mjs models`).

## Video
| Key | Model | Price | Use it for |
|---|---|---|---|
| `sd2-mini` | Seedance 2.0 Mini | 480p $0.019/s · 720p $0.041/s | **Default.** Drafts and most finals. Refs + voice refs, native lip-sync. |
| `grok` | Grok Imagine | 480p $0.012/s · 720p $0.0225/s | Cheapest motion, B-roll, quick tests. Min 6s, audio always on. |
| `wan3` | Wan 3.0 | 480p $0.04/s · 720p $0.08/s | **Default for finals.** Sharpest in the bake-off; refs + voice refs; 2–30s so shots can be exactly 2–3s. |
| `wan3-prime` | Wan 3.0 Prime | 720p $0.126/s | Upgrade a hero shot. |
| `sd2-fast` | Seedance 2.0 Fast | 480p $0.059/s · 720p $0.124/s | Upgrade a key shot when Mini isn't good enough. |
| `kling3` | Kling 3.0 std | $0.07/s silent · $0.10/s with audio | Start→end frame moves, product orbits. |
| `sd2` / `sd2.5` | Seedance 2.0 / 2.5 | 720p $0.205/s / $0.315/s | Only when a shot must be perfect. |

## Talking heads and lip-sync
| Key | Price | Use it for |
|---|---|---|
| `infinitetalk` | 480p $0.015/s · 720p $0.06/s | Clone/influencer: one photo + audio → talking video, up to 15s per job. |
| `kling-avatar` | 720p $0.04/s | Same, better motion. |
| `lipsync` | $0.04/s | Re-sync an existing clip to new audio (dub mode, translations). |

## Images, voice, music
| Key | Price | Use it for |
|---|---|---|
| `nb2.1` | $0.02 (1K) · $0.03 (2K) | **Default** keyframes and character sheets. Up to 10 refs. |
| `sd-flash` | $0.016 | Cheapest variants. |
| `nb2` / `nbpro` | $0.04 / $0.09 | When 2.1 loses identity. |
| `el-v3` | $0.07 per 1,000 chars | ElevenLabs v3 voices via Kie. Falls back to direct ElevenLabs if Kie fails. |
| `suno` | $0.06 per track | Score and stings (V6, instrumental). |
| `upscale` | $0.04/s | Topaz 2x for final delivery only. |

## Cost ladder for a 45s sitcom episode (9 shots)
- Keyframes 9 × 2 × $0.02 = $0.36
- Draft video at sd2-mini 480p: ~$0.85
- Rerolls (~50%): ~$0.45
- Voice + music: ~$0.10
- **≈ $1.75 per episode**, or ≈ $3.50 with all finals at 720p. Higgsfield would charge ~$1.55 for a single 8s Seedance clip.


No model is excluded by rule: `studio.mjs prices <slug>` (engine/lib/pricing.mjs) prices every model live for each project and recommends the best quality for the cost. For photoreal talking humans, Veo 3.1 Quality 720p won an A/B test; it can burn captions and jump inside a shot, which the take evals catch.
