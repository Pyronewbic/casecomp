import axios from "axios";
import { sha256 } from "../data/cache.js";
import { cacheGet, cacheSet } from "../data/firestore.js";
import { cropCorners, cornerCropsToImageBlocks } from "./preprocessing.js";

const CACHE_COLLECTION = "cache-grades";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SUBGRADE_PROMPTS = {
  centering: `Grade ONLY the centering of this Pokémon trading card photo.

PERSPECTIVE CORRECTION: Listing photos are rarely taken perfectly flat. Before assessing centering, identify the camera angle from the card's shape — if edges converge (trapezoid instead of rectangle), the card is tilted. Mentally project the card to a flat top-down view before comparing borders. Do NOT penalize centering for perspective distortion caused by camera angle.

TECHNIQUE: Describe what you observe rather than computing exact ratios. Compare left vs right borders, then top vs bottom borders. Note which direction any shift goes (e.g. "shifted slightly left" or "heavier bottom border").

PSA CENTERING THRESHOLDS (front / back):
- 10 (Gem Mint): 55/45 or better front, 75/25 or better back
- 9 (Mint): 60/40 front, 90/10 back
- 8 (NM-MT): 65/35 front, 90/10 back
- 7 (NM): 70/30 front, 90/10 back
- 6 (EX-MT): 80/20 front, 90/10 back

SCORING GUIDE:
- 10: Borders appear equal on all sides within normal printing tolerance
- 9: Slight shift in one direction, barely noticeable without close inspection
- 8: Noticeable shift — one border clearly wider than its opposite
- 7: Obvious shift — one border roughly 2x its opposite
- 6 or below: Severe shift visible at a glance

If the photo angle is steep or the card is heavily tilted, set confidence below 0.5 — precise centering cannot be reliably assessed from angled photos.

Respond ONLY with valid JSON (no markdown):
{"score": <number 1-10>, "confidence": <number 0-1>, "detail": "<one sentence: which borders are uneven and by how much, note if angle limits reliability>"}`,

  corners: `Grade ONLY the corners of this Pokémon trading card photo. Examine each of the 4 corners individually: top-left, top-right, bottom-left, bottom-right.

WHAT TO LOOK FOR per corner:
- Whitening: white fibers visible along the corner edge (most common defect)
- Rounding: corner lost its sharp point, appears soft or curved
- Dings/dents: physical impact marks, often small indentations
- Lifting: layers of cardstock separating at the corner
- Fuzzing: frayed edge fibers at the corner point

PSA CORNER THRESHOLDS:
- 10 (Gem Mint): All 4 corners sharp and clean, no whitening under magnification
- 9 (Mint): Corners sharp, may have one tiny spot of whitening only visible under magnification
- 8 (NM-MT): Minor whitening on 1-2 corners, still sharp points
- 7 (NM): Slight whitening or softness on 2-3 corners
- 6 (EX-MT): Noticeable whitening or slight rounding on multiple corners
- 5 (EX): Moderate whitening, possible rounding on 1+ corners

DARK-BORDERED CARDS: Whitening is more visible and more harshly penalized on dark/black borders. Grade these more critically.

If the photo lacks close-up detail, note which corners you can and cannot assess clearly, and set confidence accordingly.

Respond ONLY with valid JSON (no markdown):
{"score": <number 1-10>, "confidence": <number 0-1>, "detail": "<one sentence: condition of worst corner(s), name which corners are affected>"}`,

  edges: `Grade ONLY the edges of this Pokémon trading card photo. Examine each of the 4 edges individually: top, bottom, left, right.

WHAT TO LOOK FOR per edge:
- Whitening: white line along the edge where color has worn away
- Chipping: small chips or flakes missing from the edge
- Nicks: tiny cuts or indentations along the edge
- Roughness: uneven or jagged edge surface
- Peeling: cardstock layers separating along the edge

PSA EDGE THRESHOLDS:
- 10 (Gem Mint): All edges clean and smooth, no whitening or wear
- 9 (Mint): Edges clean, one minor spot of whitening only visible under magnification
- 8 (NM-MT): Minor whitening on 1-2 edges, no chipping
- 7 (NM): Light whitening along 2+ edges, or one small chip
- 6 (EX-MT): Noticeable whitening on multiple edges, minor chipping possible
- 5 (EX): Moderate whitening, possible chipping on 1+ edges

DARK-BORDERED CARDS: Edge whitening is far more visible against dark/black card borders. Apply stricter standards.

BACK EDGES: If a back image is provided, back edges often show more wear than the front — check carefully.

If the photo lacks close-up detail, note which edges you can assess and set confidence accordingly.

Respond ONLY with valid JSON (no markdown):
{"score": <number 1-10>, "confidence": <number 0-1>, "detail": "<one sentence: condition of worst edge(s), name which edges are affected>"}`,

  surface: `Grade ONLY the surface of this Pokémon trading card photo. Assess the entire printable area of the card.

WHAT TO LOOK FOR:
- Scratches: linear marks across the surface, often visible when light catches them
- Print lines: factory printing defects, thin lines running through the card
- Ink spots/blotches: spots of excess ink or missing ink
- Dents/indentations: depressions in the cardstock visible as shadows
- Holo wear/scratching: wear patterns on holographic/foil areas
- Surface contamination: fingerprints, residue, sticker marks, or foreign material
- Creasing: any crease, even minor, severely limits grade (PSA 5 max for crease <1 inch)

PSA SURFACE THRESHOLDS:
- 10 (Gem Mint): Surface immaculate, no defects visible even under magnification
- 9 (Mint): Surface clean, one minor print imperfection allowed if not immediately noticeable
- 8 (NM-MT): Minor surface wear or one small print line, no scratches
- 7 (NM): Light surface wear, minor print defects, or one faint scratch
- 6 (EX-MT): Noticeable surface wear, light scratches, or print defects
- 5 (EX): Moderate scratches, print defects, or minor surface damage

HOLOGRAPHIC/FOIL CARDS: Holo surfaces reflect light differently at various angles, which can both mask and reveal scratches. Note when holo patterns limit your assessment — glare in the photo may hide real scratches, so lower confidence if holo area is washed out or reflective. Do NOT assume a clean surface just because glare obscures it.

PHOTO QUALITY: Listing photos are often low-resolution or poorly lit. Surface defects are the hardest to detect from photos. If the image quality prevents confident surface assessment, set confidence below 0.5.

Respond ONLY with valid JSON (no markdown):
{"score": <number 1-10>, "confidence": <number 0-1>, "detail": "<one sentence: specific defects found or clean assessment, note if holo/glare limits visibility>"}`,
};

const GRADING_PROMPT = `You are estimating the PSA grade for a Pokémon trading card based on listing photos. You may receive 1-2 images (front, back, or both).

PERSPECTIVE CORRECTION: Listing photos are rarely taken flat. If the card appears as a trapezoid rather than a rectangle, mentally project it to a top-down view before assessing centering. Do NOT penalize centering for camera-angle distortion.

PSA GRADE SCALE:
- 10 (Gem Mint): Virtually perfect. Centering 55/45+, sharp corners, clean edges, flawless surface.
- 9 (Mint): One minor flaw. Centering 60/40, one tiny whitening spot, or one faint print line.
- 8 (NM-MT): Minor wear. Slight centering shift, whitening on 1-2 corners, minor edge wear.
- 7 (NM): Noticeable wear. Off-center, whitening on 2-3 corners, light edge/surface wear.
- 6 (EX-MT): Moderate wear across multiple attributes.
- 5 (EX) or below: Significant wear, possible creases, heavy whitening.

SUBGRADE GUIDANCE:
- CENTERING: Describe border asymmetry rather than computing exact ratios. Check front AND back — back centering is often the grade limiter.
- CORNERS: Check all 4 individually. Dark-bordered cards show whitening more — grade stricter.
- EDGES: Check all 4 individually. Back edges often worse than front.
- SURFACE: Holo/foil cards may hide scratches under glare — do NOT assume clean when glare obscures. Creases cap at PSA 5.

Be conservative. Most listed raw cards grade PSA 6-9; PSA 10 is rare. When uncertain, grade lower and note low confidence.

If only full shots are provided (no close-ups), you CAN still grade centering and surface reliably. For corners and edges, grade what you can see but lower confidence. Do NOT refuse to grade — give your best estimate.

Respond ONLY with valid JSON in this exact shape (no markdown, no prose):
{
  "overall": <number 1-10, can be 0.5 increments>,
  "centering": <number 1-10>,
  "corners": <number 1-10>,
  "edges": <number 1-10>,
  "surface": <number 1-10>,
  "confidence": <number 0-1, lower if photo is bad, angled, or missing close-ups>,
  "notes": "<one sentence: main grade-limiting factor>",
  "limitations": "<which sub-grades lack close-up detail or are affected by photo angle, or empty string>"
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
    limitations: typeof o.limitations === "string" ? o.limitations : "",
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
  return cacheGet(CACHE_COLLECTION, key);
}

export async function cacheGrade(imageUrl, config, result) {
  if (!config.aiGrading.cacheGrades) return;
  const key = sha256(`${imageUrl}|${cacheModelKey(config)}`);
  await cacheSet(CACHE_COLLECTION, key, result, CACHE_TTL_MS);
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

export async function gradeViaClaude(imageUrl, config, extraImages = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  await throttleLlm();
  const imageBlocks = [imageUrl, ...extraImages]
    .filter(Boolean)
    .map(url => ({ type: "image", source: { type: "url", url } }));
  const body = {
    model: config.aiGrading.llm.model,
    max_tokens: config.aiGrading.llm.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
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

export async function gradeViaOpenAI(imageUrl, config, extraImages = []) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  await throttleLlm();
  const imageBlocks = [imageUrl, ...extraImages]
    .filter(Boolean)
    .map(url => ({ type: "image_url", image_url: { url } }));
  const body = {
    model: config.aiGrading.llm.model,
    max_tokens: config.aiGrading.llm.maxTokens,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: GRADING_PROMPT },
          ...imageBlocks,
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

export async function gradeViaLLM(imageUrl, config, extraImages = []) {
  const p = config.aiGrading.llm.provider;
  if (p === "openai") return gradeViaOpenAI(imageUrl, config, extraImages);
  return gradeViaClaude(imageUrl, config, extraImages);
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

async function gradeSubgrade(subgrade, imageUrls, config, extraBlocks = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  await throttleLlm();
  const imageBlocks = imageUrls.filter(Boolean).map(url => ({ type: "image", source: { type: "url", url } }));
  const body = {
    model: config.aiGrading.llm.model,
    max_tokens: 200,
    messages: [{ role: "user", content: [...imageBlocks, ...extraBlocks, { type: "text", text: SUBGRADE_PROMPTS[subgrade] }] }],
  };
  const res = await withLlm429Backoff(() =>
    axios.post("https://api.anthropic.com/v1/messages", body, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      timeout: 120_000,
    }),
  );
  const text = res.data?.content?.map(b => b.type === "text" ? b.text : "").join("") || "";
  const parsed = parseGradeJSON(text);
  if (parsed.error) return null;
  return { score: clampSub(parsed.ok.score), confidence: clampConf(parsed.ok.confidence), detail: parsed.ok.detail || "" };
}

export async function gradeDetailedLLM(frontUrl, backUrl, config, extraImages = []) {
  const known = new Set([frontUrl, backUrl].filter(Boolean));
  const deduped = extraImages
    .map(e => (typeof e === "string" ? e : e?.imageUrl))
    .filter(u => u && !known.has(u));
  const allImages = [frontUrl, backUrl, ...deduped].filter(Boolean);

  let cornerBlocks = [];
  try {
    const cropJobs = [frontUrl, backUrl].filter(Boolean).map(url => cropCorners(url));
    const allCrops = (await Promise.all(cropJobs)).flat();
    cornerBlocks = cornerCropsToImageBlocks(allCrops);
  } catch (e) {
    console.warn(`[grade] corner crop failed, using full images: ${e.message || e}`);
  }

  const primaryImages = [frontUrl, backUrl].filter(Boolean);
  const [centering, corners, edges, surface] = await Promise.all([
    gradeSubgrade("centering", allImages, config),
    gradeSubgrade("corners", primaryImages, config, cornerBlocks),
    gradeSubgrade("edges", allImages, config),
    gradeSubgrade("surface", allImages, config),
  ]);

  if (!centering || !corners || !edges || !surface) return null;

  const overall = Math.min(centering.score, corners.score, edges.score, surface.score);
  const avgConf = (centering.confidence + corners.confidence + edges.confidence + surface.confidence) / 4;

  const lowest = [
    { name: "centering", ...centering },
    { name: "corners", ...corners },
    { name: "edges", ...edges },
    { name: "surface", ...surface },
  ].sort((a, b) => a.score - b.score)[0];

  return {
    provider: "claude",
    mode: "llm-detailed",
    overall,
    centering: centering.score,
    corners: corners.score,
    edges: edges.score,
    surface: surface.score,
    confidence: clampConf(avgConf),
    notes: `Grade limiter: ${lowest.name} — ${lowest.detail}`,
    limitations: backUrl ? "" : "Back not available — centering and edge grades are front-only estimates.",
    subgradeDetails: { centering, corners, edges, surface },
  };
}

export async function gradeImage(imageUrl, config, extraImages = []) {
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
      const backImg = extraImages[0]?.imageUrl || extraImages[0] || null;
      const remainingExtras = extraImages.slice(1);
      if (backImg && config.aiGrading.llm.provider === "claude") {
        result = await gradeDetailedLLM(imageUrl, backImg, config, remainingExtras);
      }
      if (!result) {
        result = await gradeViaLLM(imageUrl, config, extraImages);
      }
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
