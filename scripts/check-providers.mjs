// Offline checks of the two providers (2026-10-22): APIMart is the main one, Kie the second; every job goes to the
// cheaper live price (APIMart wins ties), a refused APIMart submit moves to Kie at a re-checked budget, the ledger
// keeps what APIMart says it charged, the guard treats APIMart like Kie, and no key ever reaches a repo.
// No paid call: price files are written to a temp copy and restored.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export default async function (t, ROOT) {
  const M = await import("../engine/lib/models.mjs");
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

  // A fake price file decides who is cheaper, then the real one comes back.
  const file = M.APIMART_PRICES, saved = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const keys = { a: process.env.APIMART_API_KEY, k: process.env.KIE_API_TOKEN, f: process.env.VF_PROVIDER };
  process.env.APIMART_API_KEY ||= "test-not-a-key"; process.env.KIE_API_TOKEN ||= "test-not-a-key"; delete process.env.VF_PROVIDER;
  try {
    const write = (models) => { fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), models })); fs.utimesSync(file, new Date(), new Date(Date.now() + Math.random() * 1e6)); };
    write({ "seedance-2.0-mini": { resolution_paid_prices: { "720P": 0.02 } }, "kling-v3": { paid_price: 0.07, billing_tier_paid_prices: { sound: 0.5 } }, "veo3.1-quality": { paid_price: 1 } });
    const sd = M.offers("sd2-mini", { res: "720p", duration: 5 });
    t("providers: the cheaper live price runs the job (APIMart here) and cost() is that price", sd[0].provider === "apimart" && Math.abs(sd[0].credits - 20) < 0.01 && M.getModel("sd2-mini").cost({ res: "720p", duration: 5 }) === sd[0].credits);
    const kl = M.offers("kling3", { res: "720p", duration: 5, sound: true });
    t("providers: Kie runs the job when it is clearly cheaper", kl[0].provider === "kie");
    write({ "seedance-2.0-mini": { resolution_paid_prices: { "720P": 8.2 * 0.005 * 1.015 } } });
    t("providers: APIMart wins a tie within 2 % (the main provider)", M.offers("sd2-mini", { res: "720p", duration: 5 })[0].provider === "apimart");
    t("providers: what APIMart can't run goes to Kie (Veo only films 8 s there)", M.offers("veo", { res: "720p", duration: 4 }).every((o) => o.provider === "kie") && M.offers("veo", { res: "720p", duration: 8 })[0].provider === "apimart");
    process.env.VF_PROVIDER = "kie";
    t("providers: VF_PROVIDER forces one provider", M.offers("sd2-mini", { res: "720p", duration: 5 }).every((o) => o.provider === "kie"));
    delete process.env.VF_PROVIDER;
    const b = M.apimartSpec("sd2").build({ prompt: "p", frame: "https://x/a.png", lastFrame: "https://x/b.png", res: "720p", duration: 5, ar: "9:16" });
    t("providers: APIMart requests carry first and last frames by role", b.image_with_roles?.[0]?.role === "first_frame" && b.image_with_roles?.[1]?.role === "last_frame" && b.model === "seedance-2.0");
  } finally {
    if (saved) fs.writeFileSync(file, saved); else fs.rmSync(file, { force: true });
    for (const [k, v] of [["APIMART_API_KEY", keys.a], ["KIE_API_TOKEN", keys.k], ["VF_PROVIDER", keys.f]]) if (v == null) delete process.env[k]; else process.env[k] = v;
  }

  const gen = read("engine/gen.mjs"), pv = read("engine/lib/providers.mjs");
  t("providers: a refused APIMart submit moves to the next provider and the budget is checked again at its price", pv.includes("if (i) await onSwitch?.(o, lastErr)") && gen.includes("caps(o.credits, credits)"));
  t("providers: an accepted job is never resubmitted elsewhere; the lock names its provider for recover", gen.includes("JSON.stringify({ taskId, provider,") && gen.includes('PV.wait(j.provider || "kie"'));
  t("providers: the ledger keeps what APIMart says it charged", gen.includes("charged != null ? charged / 0.005 : credits"));
  t("providers: live prices come from both providers before every Production Book", read("engine/lib/pricing.mjs").includes("await apimartPrices({ maxAgeH })") && read("engine/lib/pricing.mjs").includes("apimartOffer(key"));
  t("providers: the vision judge tries APIMart first, then Kie", read("engine/lib/judge.mjs").indexOf('tries.push(["apimart"') < read("engine/lib/judge.mjs").indexOf('tries.push(["kie"'));

  const { decide } = await import("./hooks/guard.mjs");
  const deny = (cmd) => !!decide({ tool_name: "Bash", tool_input: { command: cmd } });
  t("providers: the guard blocks APIMart calls outside the engine and lets its public price list through", deny('curl -X POST https://api.apimart.ai/v1/videos/generations -d "{}"') && !deny("curl https://api.apimart.ai/api/pricing/model?model=kling-v3"));

  // No key in any tracked file, in this repo or (through publish-public's SECRET) the public one.
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter((f) => f && !/\.(png|jpe?g|mp4|mp3|wav|webp|pdf|zip)$/i.test(f));
  const KEY = /\bsk-[A-Za-z0-9]{40,}|APIMART_API_KEY=\s*[A-Za-z0-9_-]{16,}/;
  const leaked = tracked.filter((f) => { try { return KEY.test(fs.readFileSync(path.join(ROOT, f), "utf8")); } catch { return false; } });
  t(`providers: no APIMart key in any tracked file (${leaked.join(", ") || "none"})`, !leaked.length);
  // The public edition has no publish script: there the tracked-file scan above is the guard.
  const pub = fs.existsSync(path.join(ROOT, "scripts", "publish-public.mjs")) ? read("scripts/publish-public.mjs") : null;
  t("providers: .env is ignored by git and the public leak scan catches APIMart keys", spawnSync("git", ["check-ignore", "-q", ".env"], { cwd: ROOT }).status === 0 && (pub == null || (pub.includes("APIMART_API_KEY=") && pub.includes("sk-[A-Za-z0-9]{40,}"))));
}
