// Provider routing. APIMart is the main provider and Kie the second one. Every paid job goes to the
// cheapest provider that can run it (models.mjs offers(), APIMart winning ties); if APIMart refuses the submit
// (no balance, a parameter it doesn't take, a busy server), nothing was billed and the job goes to Kie instead.
// A job that was accepted is never resubmitted elsewhere: it may still bill.
import path from "node:path";
import * as kie from "./kie.mjs";
import * as apimart from "./apimart.mjs";
import { hasKie, hasApimart } from "./env.mjs";
import { getModel, offers, apimartSpec } from "./models.mjs";

export const CREDIT_USD = 0.005;

// The offers for one job, cheapest first: [{ provider, credits }].
export function route(modelKey, req) {
  return offers(modelKey, req);
}

// Submit one job to one provider. Returns the task id.
export async function submit(provider, modelKey, req) {
  const m = getModel(modelKey);
  if (provider === "apimart") {
    const a = apimartSpec(modelKey);
    if (!a) throw new Error(`${modelKey} is not sold on APIMart`);
    return apimart.createTask(a.kind, a.build(req));
  }
  return kie.createTask(m.modelFor ? m.modelFor(req) : m.model, m.build(req));
}

// Wait for a task. Returns { urls, usd } (usd: what the provider says it charged, when it says).
export async function wait(provider, taskId, opts) {
  if (provider === "apimart") {
    const { urls, record } = await apimart.waitTask(taskId, opts);
    return { urls, usd: record.usd };
  }
  const { urls } = await kie.waitTask(taskId, opts);
  return { urls, usd: null };
}

// Submit to the first offer; when APIMart refuses (no task created), move to the next offer.
// onSwitch(offer) runs before the move so the caller can re-check the budget at the new price.
export async function submitBest(modelKey, req, { onSwitch } = {}) {
  const list = route(modelKey, req);
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (i) await onSwitch?.(o, lastErr);
    try {
      return { ...o, taskId: await submit(o.provider, modelKey, req) };
    } catch (e) {
      lastErr = e;
      if (o.provider !== "apimart" || i === list.length - 1) throw e;
      process.stderr.write(`  APIMart refused ${modelKey} (${e.message.slice(0, 140)}); trying ${list[i + 1].provider}\n`);
    }
  }
  throw lastErr;
}

// Submit and wait in one call (series intro, small jobs outside a project).
export async function run(modelKey, req, opts = {}) {
  const o = await submitBest(modelKey, req);
  const r = await wait(o.provider, o.taskId, opts);
  return { ...r, provider: o.provider, credits: r.usd != null ? r.usd / CREDIT_USD : o.credits };
}

// Host a local file for the models. Kie's file host is free and takes any media; APIMart's takes images and needs
// a balance. A URL passes through.
export async function upload(file) {
  const img = /\.(png|jpe?g|webp)$/i.test(file);
  if (hasKie()) {
    try { return await kie.upload(file); } catch (e) { if (!(img && hasApimart())) throw e; }
  }
  if (img && hasApimart()) return apimart.upload(file);
  throw new Error(`no host for ${path.basename(file)}: a Kie key is needed for audio and video references`);
}
export const asUrl = (v) => (/^https?:\/\//i.test(v) ? Promise.resolve(v) : upload(v));
export const download = kie.download;

// Balances of the providers the engine has keys for, in USD.
export async function balances() {
  const out = {};
  if (hasApimart()) out.apimart = await apimart.balance().catch((e) => e.message.slice(0, 120));
  if (hasKie()) out.kie = await kie.credits().then((c) => +(c * CREDIT_USD).toFixed(2)).catch((e) => e.message.slice(0, 120));
  return out;
}
