import axios from "axios";
import { readJsonCache, writeJsonCache, sha256, cachePath } from "./cache.js";

const CACHE_FILE = "ai-grade-cache.json";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GRADING_PROMPT = `You are estimating the PSA grade for a Pokémon trading card based on a single product photo from an eBay listing. PSA grades cards 1-10 on:
- CENTERING: borders should be even on all sides (PSA 10 ≈ 55/45 or better)
- CORNERS: should be sharp, no whitening or rounding
- EDGES: should be clean, no whitening or chipping
- SURFACE: no scratches, dents, print defects, or holo wear

Be conservative. eBay listing photos are often poor quality, glare-heavy, or hide defects. When uncertain, grade lower and note low confidence. Most listed raw cards grade between PSA 6-9; PSA 10 is rare.

Respond ONLY with valid JSON in this exact shape (no markdown, no prose):
{
  "overall": <number 1-10, can be 0.5 increments>,
  "centering": <number 1-10>,
  "corners": <number 1-10>,
  "edges": <number 1-10>,
  "surface": <number 1-10>,
  "confidence": <number 0-1, lower if photo is bad>,
  "notes": "<one sentence: main factor in your grade>"
}`;

let lastLlmAt = 0;
let lastSiteAt = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleLlm() {
  const wait = 1000 - (Date.now() - lastLlmAt);
  if (wait > 0) await sleep(wait);
  lastLlmAt = Date.now();
}

async function throttleSite() {
  const wait = 1000 - (Date.now() - lastSiteAt);
  if (wait > 0) await sleep(wait);
  lastSiteAt = Date.now();
}

async function withLlm429Backoff(fn) {
  const delays = [1000, 2000, 4000, 8000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e.response?.status === 429 && i < delays.length) {
        await sleep(delays[i]);
        continue;
      }
      throw e;
    }
  }
}

export function parseGradeJSON(text) {
  if (!text || typeof text !== "string") return { error: "empty", raw: text };
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const o = JSON.parse(s);
    return { ok: o };
  } catch (e) {
    return { error: e.message, raw: text };
  }
}

function clampSub(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Math.min(10, Math.max(1, x));
}

function clampOverall(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return null;
  return Math.min(10, Math.max(1, x));
}

function clampConf(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0.5;
  return Math.min(1, Math.max(0, x));
}

function validateAndShape(provider, mode, o, raw) {
  const overall = clampOverall(o.overall);
  const centering = clampSub(o.centering);
  const corners = clampSub(o.corners);
  const edges = clampSub(o.edges);
  const surface = clampSub(o.surface);
  if (
    overall == null ||
    centering == null ||
    corners == null ||
    edges == null ||
    surface == null
  ) {
    return { error: "missing or invalid numeric fields", raw };
  }
  return {
    provider,
    mode,
    overall,
    centering,
    corners,
    edges,
    surface,
    confidence: clampConf(o.confidence),
    notes: typeof o.notes === "string" ? o.notes : "",
    raw,
  };
}

function cacheModelKey(config) {
  if (config.aiGrading.mode === "llm") {
    return `${config.aiGrading.llm.provider}:${config.aiGrading.llm.model}`;
  }
  return `${config.aiGrading.site.provider}:site`;
}

export async function getCachedGrade(imageUrl, config) {
  if (!config.aiGrading.cacheGrades) return null;
  const key = sha256(`${imageUrl}|${cacheModelKey(config)}`);
  const disk = await readJsonCache(CACHE_FILE, 0);
  const ent = disk?.grades?.[key];
  if (!ent?.result || !ent?.expiresAt || ent.expiresAt < Date.now()) return null;
  return ent.result;
}

export async function cacheGrade(imageUrl, config, result) {
  if (!config.aiGrading.cacheGrades) return;
  const key = sha256(`${imageUrl}|${cacheModelKey(config)}`);
  const disk = (await readJsonCache(CACHE_FILE, 0)) || { grades: {} };
  disk.grades = disk.grades || {};
  disk.grades[key] = {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
    imageUrl,
    keyHint: cacheModelKey(config),
  };
  await writeJsonCache(CACHE_FILE, disk);
}

const EBAY_SIZE_RE = /[/._-]s[_-]?l(\d+)/i;

export async function getImageMinWidthHint(imageUrl) {
  if (!imageUrl) return 0;
  const m = String(imageUrl).match(EBAY_SIZE_RE);
  if (m) return parseInt(m[1], 10);
  try {
    const res = await axios.head(imageUrl, {
      timeout: 10_000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const wh =
      res.headers["x-image-width"] ||
      res.headers["image-width"] ||
      res.headers["x-original-width"];
    if (wh && !Number.isNaN(parseInt(wh, 10))) return parseInt(wh, 10);
  } catch {
    /* ignore */
  }
  return 500;
}

export async function gradeViaClaude(imageUrl, config) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  await throttleLlm();
  const body = {
    model: config.aiGrading.llm.model,
    max_tokens: config.aiGrading.llm.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: GRADING_PROMPT },
        ],
      },
    ],
  };
  const res = await withLlm429Backoff(() =>
    axios.post("https://api.anthropic.com/v1/messages", body, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 120_000,
    }),
  );
  const text =
    res.data?.content?.map((b) => (b.type === "text" ? b.text : "")).join("") ||
    "";
  const parsed = parseGradeJSON(text);
  if (parsed.error) {
    console.warn(`[grade] Claude parse: ${parsed.error}`);
    return { error: parsed.error, raw: res.data };
  }
  return validateAndShape(
    "claude",
    "llm",
    parsed.ok,
    res.data,
  );
}

export async function gradeViaOpenAI(imageUrl, config) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  await throttleLlm();
  const body = {
    model: config.aiGrading.llm.model,
    max_tokens: config.aiGrading.llm.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: GRADING_PROMPT },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  };
  const res = await withLlm429Backoff(() =>
    axios.post("https://api.openai.com/v1/chat/completions", body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      timeout: 120_000,
    }),
  );
  const text = res.data?.choices?.[0]?.message?.content || "";
  const parsed = parseGradeJSON(text);
  if (parsed.error) {
    console.warn(`[grade] OpenAI parse: ${parsed.error}`);
    return { error: parsed.error, raw: res.data };
  }
  return validateAndShape("openai", "llm", parsed.ok, res.data);
}

export async function gradeViaLLM(imageUrl, config) {
  const p = config.aiGrading.llm.provider;
  if (p === "openai") return gradeViaOpenAI(imageUrl, config);
  return gradeViaClaude(imageUrl, config);
}

function pickNum(o, keys, fallback = null) {
  for (const k of keys) {
    if (o[k] != null && !Number.isNaN(Number(o[k]))) return Number(o[k]);
  }
  return fallback;
}

function normalizeSiteBody(body, provider, raw) {
  const o = body && typeof body === "object" ? body : {};
  const overall = pickNum(o, ["overall", "grade", "psa", "psa_grade"], null);
  if (overall == null) return { error: "site response missing grade", raw };
  const centering = pickNum(o, ["centering", "center"], overall);
  const corners = pickNum(o, ["corners", "corner"], overall);
  const edges = pickNum(o, ["edges", "edge"], overall);
  const surface = pickNum(o, ["surface"], overall);
  const confidence = pickNum(o, ["confidence", "score_confidence"], 0.6);
  const notes = o.notes || o.summary || "";
  return validateAndShape(provider, "site", {
    overall,
    centering,
    corners,
    edges,
    surface,
    confidence,
    notes,
  }, raw);
}

async function postSiteGrader(url, apiKey, imageUrl, extraHeaders = {}) {
  await throttleSite();
  const headers = {
    "content-type": "application/json",
    ...extraHeaders,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }
  const res = await withLlm429Backoff(() =>
    axios.post(
      url,
      { imageUrl, image_url: imageUrl, url: imageUrl },
      { headers, timeout: 120_000 },
    ),
  );
  return res.data;
}

export async function gradeViaTCGrader(imageUrl) {
  const base = process.env.TCGRADER_API_URL;
  const key = process.env.TCGRADER_API_KEY;
  if (!base || !key) throw new Error("TCGRADER_API_URL/TCGRADER_API_KEY");
  const data = await postSiteGrader(base, key, imageUrl);
  return normalizeSiteBody(data, "tcgrader", data);
}

export async function gradeViaPokeGrade(imageUrl) {
  const base = process.env.POKEGRADE_API_URL;
  const key = process.env.POKEGRADE_API_KEY;
  if (!base || !key) throw new Error("POKEGRADE_API_URL/POKEGRADE_API_KEY");
  const data = await postSiteGrader(base, key, imageUrl);
  return normalizeSiteBody(data, "pokegrade", data);
}

export async function gradeViaSnapGrade(imageUrl) {
  const base = process.env.SNAPGRADE_API_URL;
  const key = process.env.SNAPGRADE_API_KEY;
  if (!base || !key) throw new Error("SNAPGRADE_API_URL/SNAPGRADE_API_KEY");
  const data = await postSiteGrader(base, key, imageUrl);
  return normalizeSiteBody(data, "snapgrade", data);
}

export async function gradeViaLocal(imageUrl) {
  const base = process.env.LOCAL_GRADER_URL;
  if (!base) throw new Error("LOCAL_GRADER_URL");
  const data = await postSiteGrader(base, null, imageUrl);
  return normalizeSiteBody(data, "local", data);
}

export async function gradeViaSite(imageUrl, config) {
  const p = config.aiGrading.site.provider;
  switch (p) {
    case "tcgrader":
      return gradeViaTCGrader(imageUrl);
    case "pokegrade":
      return gradeViaPokeGrade(imageUrl);
    case "snapgrade":
      return gradeViaSnapGrade(imageUrl);
    case "local":
      return gradeViaLocal(imageUrl);
    default:
      return { error: `unknown site provider ${p}`, raw: {} };
  }
}

export async function gradeImage(imageUrl, config) {
  if (!config.aiGrading.enabled) return null;
  if (!imageUrl) return null;
  try {
    const w = await getImageMinWidthHint(imageUrl);
    if (w > 0 && w < 400) {
      console.warn(`[grade] skip image (width hint ${w}px): ${imageUrl}`);
      return null;
    }
  } catch {
    /* continue */
  }

  const cached = await getCachedGrade(imageUrl, config);
  if (cached) return cached;

  let result;
  try {
    if (config.aiGrading.mode === "llm") {
      result = await gradeViaLLM(imageUrl, config);
    } else if (config.aiGrading.mode === "site") {
      result = await gradeViaSite(imageUrl, config);
    } else {
      return null;
    }
  } catch (e) {
    console.warn(`[grade] ${e.message || e}`);
    return { error: e.message || String(e), raw: e.response?.data };
  }

  if (result && !result.error) {
    await cacheGrade(imageUrl, config, result);
  }
  return result;
}

const TEST_IMAGE_URL =
  "https://images.pokemontcg.io/base1/58.png";

export async function testGradingProvider(config) {
  const cfg = { ...config, aiGrading: { ...config.aiGrading, enabled: true } };
  try {
    let r;
    if (cfg.aiGrading.mode === "llm") {
      r = await gradeViaLLM(TEST_IMAGE_URL, cfg);
    } else if (cfg.aiGrading.mode === "site") {
      r = await gradeViaSite(TEST_IMAGE_URL, cfg);
    } else {
      return { ok: true };
    }
    if (r && r.error) return { ok: false, error: new Error(r.error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function printSiteGradingHelp() {
  console.warn(
    `Site grading providers don't expose public APIs by default. Options:
 1. Sign up at the provider, check account settings for API access
 2. Self-host github.com/crimsonthinker/psa_pokemon_cards as 'local'
 3. Switch to LLM grading: --grade-mode llm --llm-provider claude
 4. Disable: omit --grade`,
  );
}
