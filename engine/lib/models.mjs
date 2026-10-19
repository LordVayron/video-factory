// Model registry. One generic request shape in, a model-specific Kie input out,
// plus a cost estimate in credits (1 credit = $0.005).
// Prices come from Kie's live price feed (node engine/gen.mjs prices) — checked 2026-10-08.
//
// Generic request (any field may be absent):
//   prompt, ar ("9:16"), res ("480p"|"720p"|"1080p"), duration (s),
//   frame (first-frame url), lastFrame, refs [image urls], refAudio [audio urls],
//   refVideo [video urls], audio (driving speech url), sound (bool), n (variants)

const per = (table, res, fallbackRes) => table[res] ?? table[fallbackRes];

// Seedance 2 family: three mutually exclusive input modes (first/last frame,
// multimodal references, text-only). The engine picks the mode from what is given.
function seedanceInput(req, allowed, adaptiveFrames = false) {
  // Unsupported resolution: use the highest the model offers (never silently drop to the lowest).
  const res = allowed.includes(req.res) ? req.res : allowed[allowed.length - 1];
  const input = {
    prompt: req.prompt,
    aspect_ratio: req.ar || "9:16",
    resolution: res,
    duration: Math.max(4, Math.min(15, Math.round(req.duration || 5))),
    generate_audio: req.sound !== false,
  };
  const hasRefs = req.refs?.length || req.refAudio?.length || req.refVideo?.length;
  if (hasRefs) {
    // Reference mode. The keyframe goes in as reference image 1 and the prompt
    // says to open on it; that is how frame + voice ref coexist.
    const imgs = [req.frame, ...(req.refs || [])].filter(Boolean).slice(0, 9);
    if (imgs.length) input.reference_image_urls = imgs;
    if (req.refAudio?.length) input.reference_audio_urls = req.refAudio.slice(0, 3);
    if (req.refVideo?.length) input.reference_video_urls = req.refVideo.slice(0, 3);
  } else if (req.frame) {
    input.first_frame_url = req.frame;
    if (req.lastFrame) input.last_frame_url = req.lastFrame;
    // Seedance 2.5 rejects a fixed ratio in frame modes; the frame itself sets it.
    if (adaptiveFrames) input.aspect_ratio = "adaptive";
  }
  return input;
}

const sd = (id, label, table, resList, tier) => ({
  key: id, kind: "video", tier, label,
  model: { "sd2-mini": "bytedance/seedance-2-mini", "sd2-fast": "bytedance/seedance-2-fast", sd2: "bytedance/seedance-2", "sd2.5": "bytedance/seedance-2-5" }[id],
  resolutions: resList,
  speaks: true, refs: 9, refAudio: 3,
  build: (r) => seedanceInput(r, resList, id === "sd2.5"),
  // with-video-input billing is lower per second but counts the reference video's length too
  cost: (r) => {
    const res = resList.includes(r.res) ? r.res : resList[resList.length - 1];
    const secs = Math.max(4, Math.round(r.duration || 5));
    return per(table, res, resList[0]) * secs;
  },
});

export const MODELS = {
  // ---------------------------------------------------------------- video
  "sd2-mini": sd("sd2-mini", "Seedance 2.0 Mini", { "480p": 3.8, "720p": 8.2 }, ["480p", "720p"], "budget"),
  "sd2-fast": sd("sd2-fast", "Seedance 2.0 Fast", { "480p": 11.7, "720p": 24.8 }, ["480p", "720p"], "standard"),
  sd2: sd("sd2", "Seedance 2.0", { "480p": 19, "720p": 41, "1080p": 102 }, ["480p", "720p", "1080p"], "premium"),
  "sd2.5": sd("sd2.5", "Seedance 2.5", { "480p": 28, "720p": 63, "1080p": 158 }, ["480p", "720p", "1080p"], "premium"),

  wan3: wan("wan3", "wan/3-0-video", "Wan 3.0", { "480p": 8, "720p": 16, "1080p": 32 }, "standard"),
  "wan3-prime": wan("wan3-prime", "wan/3-0-video-prime", "Wan 3.0 Prime", { "480p": 12.2, "720p": 25.2, "1080p": 50.4 }, "premium"),

  "veo-lite": veo("veo3_lite", "Veo 3.1 Lite", { "720p": 30, "1080p": 35 }, "budget"),
  "veo-fast": veo("veo3_fast", "Veo 3.1 Fast", { "720p": 60, "1080p": 65 }, "standard"),
  veo: veo("veo3", "Veo 3.1 Quality", { "720p": 250, "1080p": 255 }, "premium"),

  grok: {
    key: "grok", kind: "video", tier: "budget", label: "Grok Imagine (audio always on)",
    model: "grok-imagine/image-to-video", resolutions: ["480p", "720p", "1080p"], speaks: true, refs: 7,
    build: (r) => ({
      prompt: r.prompt,
      image_urls: [r.frame, ...(r.refs || [])].filter(Boolean).slice(0, 7),
      mode: "normal",
      duration: String(Math.max(6, Math.min(30, Math.round(r.duration || 6)))),
      resolution: ["480p", "720p", "1080p"].includes(r.res) ? r.res : "480p",
      aspect_ratio: r.ar || "9:16",
    }),
    cost: (r) => per({ "480p": 2.4, "720p": 4.5, "1080p": 8 }, r.res, "480p") * Math.max(6, Math.round(r.duration || 6)),
  },

  kling3: {
    key: "kling3", kind: "video", tier: "standard", label: "Kling 3.0 (start+end frame, elements)",
    model: "kling-3.0/video", resolutions: ["720p", "1080p"], speaks: true, refs: 0,
    build: (r) => ({
      prompt: r.prompt,
      image_urls: [r.frame, r.lastFrame].filter(Boolean),
      sound: r.sound !== false,
      duration: String(Math.max(3, Math.min(15, Math.round(r.duration || 5)))),
      aspect_ratio: r.ar || "9:16",
      mode: r.res === "1080p" ? "pro" : "std",
      multi_shots: false,
    }),
    cost: (r) => {
      const t = r.res === "1080p" ? { on: 27, off: 18 } : { on: 20, off: 14 };
      return (r.sound !== false ? t.on : t.off) * Math.round(r.duration || 5);
    },
  },

  // ------------------------------------------------------- talking heads
  infinitetalk: {
    key: "infinitetalk", kind: "talk", tier: "budget", label: "InfiniteTalk (image + audio → talking video)",
    model: "infinitalk/from-audio", resolutions: ["480p", "720p"],
    build: (r) => ({ image_url: r.frame, audio_url: r.audio, prompt: r.prompt || "natural talking, subtle head movement", resolution: r.res === "720p" ? "720p" : "480p" }),
    cost: (r) => (r.res === "720p" ? 12 : 3) * Math.ceil(r.duration || 10),
  },
  "kling-avatar": {
    key: "kling-avatar", kind: "talk", tier: "standard", label: "Kling AI Avatar Standard 720p",
    model: "kling/ai-avatar-standard", resolutions: ["720p"],
    build: (r) => ({ image_url: r.frame, audio_url: r.audio, prompt: r.prompt || "natural talking to camera" }),
    cost: (r) => 8 * Math.ceil(r.duration || 10),
  },
  lipsync: {
    key: "lipsync", kind: "dub", tier: "budget", label: "Volcengine video-to-video lip sync",
    model: "volcengine/video-to-video-lip-sync", resolutions: ["720p", "1080p"],
    build: (r) => ({ mode: "basic", video_url: r.video, audio_url: r.audio, separate_vocal: false }),
    cost: (r) => 8 * Math.ceil(r.duration || 5),
  },

  // ---------------------------------------------------------------- image
  "nb2.1": {
    key: "nb2.1", kind: "image", tier: "budget", label: "Nano Banana 2.1", model: "nano-banana-2-1", refs: 10,
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.ar || "9:16", resolution: r.size || "1K", output_format: "png", ...(r.refs?.length ? { image_input: r.refs.slice(0, 10) } : {}) }),
    cost: (r) => ({ "1K": 4, "2K": 6, "4K": 9 })[r.size || "1K"],
  },
  nb2: {
    key: "nb2", kind: "image", tier: "standard", label: "Nano Banana 2", model: "nano-banana-2", refs: 14,
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.ar || "9:16", resolution: r.size || "1K", output_format: "png", ...(r.refs?.length ? { image_input: r.refs.slice(0, 14) } : {}) }),
    cost: (r) => ({ "1K": 8, "2K": 12, "4K": 18 })[r.size || "1K"],
  },
  nbpro: {
    key: "nbpro", kind: "image", tier: "premium", label: "Nano Banana Pro", model: "nano-banana-pro", refs: 8,
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.ar || "9:16", resolution: r.size || "1K", output_format: "png", ...(r.refs?.length ? { image_input: r.refs.slice(0, 8) } : {}) }),
    cost: (r) => (r.size === "4K" ? 24 : 18),
  },
  gpt2: {
    key: "gpt2", kind: "image", tier: "standard", label: "GPT Image 2 (strong realism and text)", refs: 10,
    model: "gpt-image-2-text-to-image",
    modelFor: (r) => (r.refs?.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image"),
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.ar || "9:16", resolution: r.size || "1K", ...(r.refs?.length ? { input_urls: r.refs.slice(0, 10) } : {}) }),
    cost: (r) => ({ "1K": 6, "2K": 10, "4K": 16 })[r.size || "1K"],
  },
  "gpt2.5": {
    key: "gpt2.5", kind: "image", tier: "standard", label: "GPT Image 2.5 Sunburst (quality tier; 1K $0.03, 2K $0.05, 4K $0.08)", refs: 16,
    model: "gpt-image-2-5-sunburst-text-to-image",
    modelFor: (r) => (r.refs?.length ? "gpt-image-2-5-sunburst-image-to-image" : "gpt-image-2-5-sunburst-text-to-image"),
    // GPT Image 2.5 has no 4:5 / 5:4; use the nearest ratio it supports.
    build: (r) => ({ prompt: r.prompt, aspect_ratio: ({ "4:5": "3:4", "5:4": "4:3" })[r.ar] || r.ar || "9:16", resolution: r.size || "1K", ...(r.refs?.length ? { input_urls: r.refs.slice(0, 16) } : {}) }),
    cost: (r) => ({ "1K": 6, "2K": 10, "4K": 16 })[r.size || "1K"],
  },
  "sd-flash": {
    key: "sd-flash", kind: "image", tier: "budget", label: "Seedream 5 Flash", refs: 10,
    model: "seedream/5-flash-text-to-image",
    modelFor: (r) => (r.refs?.length ? "seedream/5-flash-image-to-image" : "seedream/5-flash-text-to-image"),
    build: (r) => ({ prompt: r.prompt, aspect_ratio: r.ar || "9:16", size: r.size === "2K" ? "2K" : "1K", output_format: "png", ...(r.refs?.length ? { image_urls: r.refs } : {}) }),
    cost: () => 3.24,
  },

  // ---------------------------------------------------------------- audio
  "el-v3": {
    key: "el-v3", kind: "voice", tier: "standard", label: "ElevenLabs V3 (audio tags like [laughs] [whispers])",
    model: "elevenlabs/text-to-dialogue-v3",
    build: (r) => ({ dialogue: r.lines.map((l) => ({ text: l.text, voice: l.voice })), stability: r.stability ?? 0.5, ...(r.lang ? { language_code: r.lang } : {}) }),
    cost: (r) => Math.max(1, (14 * r.lines.reduce((n, l) => n + l.text.length, 0)) / 1000),
  },
  "el-v2": {
    key: "el-v2", kind: "voice", tier: "budget", label: "ElevenLabs Multilingual v2",
    model: "elevenlabs/text-to-speech-multilingual-v2",
    build: (r) => ({ text: r.lines[0].text, voice: r.lines[0].voice, stability: r.stability ?? 0.5, similarity_boost: 0.75 }),
    cost: (r) => Math.max(1, (12 * r.lines[0].text.length) / 1000),
  },
  suno: {
    key: "suno", kind: "music", tier: "budget", label: "Suno V6", model: "ai-music-api/generate",
    build: (r) => ({ model: "V6", custom_mode: true, instrumental: true, title: (r.title || "score").slice(0, 80), style: r.prompt, ...(r.duration ? { duration: Math.max(10, Math.round(r.duration)) } : {}) }),
    cost: () => 12,
  },
  upscale: {
    key: "upscale", kind: "upscale", tier: "standard", label: "Topaz video upscale 2x", model: "topaz/video-upscale",
    build: (r) => ({ video_url: r.video, upscale_factor: "2" }),
    cost: (r) => 8 * Math.ceil(r.duration || 5),
  },
};

// Wan 3.0: same three exclusive modes as Seedance (first/last frame, references, text).
// References are named Image1/Audio1 in the prompt; 2–30s; 480P/720P/1080P.
function wan(key, model, label, table, tier) {
  return {
    key, kind: "video", tier, label: `${label} (refs + voice refs, 2–30s)`, model,
    resolutions: ["480p", "720p", "1080p"], speaks: true, refs: 10, refAudio: 5,
    build: (r) => {
      const input = {
        prompt: r.prompt.replace(/@image(\d)/g, "Image$1").replace(/@audio(\d)/g, "Audio$1"),
        resolution: (["480p", "720p", "1080p"].includes(r.res) ? r.res : "720p").toUpperCase(),
        aspect_ratio: r.ar || "9:16",
        duration: Math.max(2, Math.min(30, Math.round(r.duration || 5))),
        audio: r.sound !== false,
      };
      if (r.refs?.length || r.refAudio?.length) {
        input.reference_image_urls = [r.frame, ...(r.refs || [])].filter(Boolean).slice(0, 10);
        if (r.refAudio?.length) input.reference_audio_urls = r.refAudio.slice(0, 5);
      } else if (r.frame) {
        input.first_frame_url = r.frame;
        if (r.lastFrame) input.last_frame_url = r.lastFrame;
      }
      return input;
    },
    cost: (r) => per(table, r.res, "720p") * Math.max(2, Math.round(r.duration || 5)),
  };
}

function veo(tier, label, table, costTier) {
  return {
    key: { veo3_lite: "veo-lite", veo3_fast: "veo-fast", veo3: "veo" }[tier],
    hidden: false, // offered like any model: the live price analysis (lib/pricing.mjs) decides per project
    kind: "video", tier: costTier, label: `${label} (4/6/8s, speaks dialogue in prompt)`,
    model: "veo-3-1", resolutions: ["720p", "1080p"], speaks: true, refs: 3,
    build: (r) => {
      const input = {
        prompt: r.prompt, model: tier, aspect_ratio: r.ar === "16:9" ? "16:9" : "9:16",
        resolution: r.res === "1080p" ? "1080p" : "720p",
        duration: [4, 6, 8].reduce((b, d) => (Math.abs(d - (r.duration || 8)) < Math.abs(b - (r.duration || 8)) ? d : b), 8),
      };
      if (r.frame) {
        input.generation_type = "FIRST_AND_LAST_FRAMES_2_VIDEO";
        input.image_urls = [r.frame, r.lastFrame].filter(Boolean);
      } else if (r.refs?.length && tier !== "veo3") {
        input.generation_type = "REFERENCE_2_VIDEO";
        input.image_urls = r.refs.slice(0, 3);
        input.duration = 8;
      } else input.generation_type = "TEXT_2_VIDEO";
      return input;
    },
    cost: (r) => per(table, r.res, "720p"),
  };
}

export function getModel(key) {
  const m = MODELS[key];
  if (!m) throw new Error(`unknown model "${key}". Known: ${Object.keys(MODELS).join(", ")}`);
  return m;
}

export const usd = (credits) => `$${(credits * 0.005).toFixed(3)}`;
