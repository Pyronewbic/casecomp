import "dotenv/config";
import crypto from "crypto";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger.js";
import { getAccessToken, invalidateToken, searchActive, searchSold, getEbayUsageToday, DAILY_CAP } from "./lib/sources/ebay.js";
import { searchSnkrdunk } from "./lib/sources/snkrdunk.js";
import { searchMagi } from "./lib/sources/magi.js";
import { searchYahooAuctions } from "./lib/sources/yahooauctions.js";
import { getPsaGradingSignal } from "./lib/grading/psa.js";
import { gradeImage, medianGrade } from "./lib/grading/grading.js";
import { parseListingLanguagesFromInput, filterByCondition, detectCondition, flagPriceOutliers, filterRelevantResults, isGradedCard } from "./lib/search/filters.js";
import { buildEbaySearchQuery } from "./lib/search/listingQuery.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./lib/search/ebayCategories.js";
import { saveGradeLog, getGradeLogs, getGradeLogsByUser, getGradeLog, deleteGradeLog, saveDrop, getDrops, getDrop, saveWebhook, getWebhooks, deleteWebhook, getFirestoreStatus, saveAlert, getActiveAlerts, updateAlert, getAlertsByEmail, saveErrorLog, getErrorLogs, clearErrorLogs, getPortfolio, addToPortfolio, removeFromPortfolio, updatePortfolioCard, savePortfolioSnapshot, getPortfolioSnapshots, listPortfolioUserIds, trackSearchFrequency, getTopSearchedCards } from "./lib/data/firestore.js";
import { getDemoSearchResult, getDemoResult, listDemoCards, findDemoByNumber } from "./lib/cards/demo.js";
import { csvEscape, csvRow } from "./lib/data/csv.js";
import { createApiKey, listApiKeys, listAllKeys, listKeysByOwner, getApiKey, updateApiKey, deleteApiKey, rotateApiKey, validateApiKey } from "./lib/auth/api-keys.js";
import { recordSoldPrices, getPriceHistory, computePriceTrend } from "./lib/cards/price-history.js";
import { sendAlertEmail } from "./lib/data/email.js";
import { logRequest, getAnalytics, getAnalyticsByUser } from "./lib/data/analytics.js";
import { saveGradedImages } from "./lib/cards/grading-dataset.js";
import { verifyGoogleToken, generateJwt, verifyJwt } from "./lib/auth/auth.js";
import { seedFromTCGPlayer } from "./lib/sources/tcgplayer.js";
import { getOrCreateCard, findCardByQuery, parseCardIdentity, resolveCardIdToQuery, SET_NAME_MAP } from "./lib/cards/card-identity.js";
import { initCardDatabase, searchCards, refreshCardDatabase, getAllSets, getSetWithCards, findCardByCardId } from "./lib/cards/card-database.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID().slice(0, 8);
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/logos", express.static(path.join(__dirname, "logos")));

app.get("/docs/spec.json", (req, res) => res.json(swaggerSpec));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

function getRequestToken(req) {
  const auth = req.headers.authorization;
  const query = req.query.key;
  return auth?.startsWith("Bearer ") ? auth.slice(7) : query || "";
}

function isOwnerKey(req) {
  const key = process.env.CASECOMP_API_KEY;
  if (!key) return true;
  return getRequestToken(req) === key;
}

function cachePrefix() {
  return "";
}

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const demoLimiter = rateLimit({
  windowMs: 60_000,
  max: 360,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const sandboxLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Sandbox rate limit: 5 requests per minute" },
});

function isSandboxKey(req) {
  const token = getRequestToken(req);
  return token && token === process.env.CASECOMP_SANDBOX_KEY;
}

const keyRateCounters = new Map();
function checkKeyRateLimit(keyId, limit) {
  const now = Date.now();
  const windowMs = 60_000;
  let entry = keyRateCounters.get(keyId);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    keyRateCounters.set(keyId, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

const isLocal = !process.env.K_SERVICE;
app.use("/api", (req, res, next) => {
  if (isLocal || req.path === "/health") return next();
  if (req.query.demo === "true") return demoLimiter(req, res, next);
  if (isSandboxKey(req)) return sandboxLimiter(req, res, next);
  return apiLimiter(req, res, next);
});
if (!isLocal) app.use("/v1", apiLimiter);

function classifyTier(req) {
  const token = getRequestToken(req);
  if (!token) return req.query.demo === "true" ? "demo" : "public";
  if (token === process.env.CASECOMP_API_KEY) return "owner";
  if (token === process.env.CASECOMP_SANDBOX_KEY) return "sandbox";
  if (req.query.demo === "true") return "demo";
  return "developer";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(ip || "unknown").digest("hex").slice(0, 8);
}

if (!isLocal) {
  app.use("/api", (req, res, next) => {
    if (req.path === "/health") return next();
    const start = Date.now();
    res.on("finish", () => {
      logRequest({
        path: req.path,
        method: req.method,
        status: res.statusCode,
        latencyMs: Date.now() - start,
        tier: classifyTier(req),
        userId: portfolioUserId(req),
        ipHash: hashIp(req.ip),
        userAgent: (req.headers["user-agent"] || "").substring(0, 200),
        requestId: req.requestId,
        query: req.query.q || null,
        ts: new Date().toISOString(),
      }).catch(() => {});
    });
    next();
  });
}

function safeErrorMessage(e) {
  const msg = e.message || String(e);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(msg)) return "Upstream service unavailable";
  if (/api[_-]?key|token|secret|credential/i.test(msg)) return "Authentication error";
  if (/firestore|grpc|google/i.test(msg)) return "Internal storage error";
  if (msg.length > 200) return msg.slice(0, 200);
  return msg;
}

async function logError(type, message, detail = "", requestId = "") {
  console.error(`[ERROR] [${requestId}] ${type}: ${message}`);
  try { await saveErrorLog({ type, message, detail, requestId, ts: new Date().toISOString() }); } catch {}
}

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;
async function getToken() { return getAccessToken(clientId, clientSecret); }
async function on401() { invalidateToken(); }

function validateQuery(q, res) {
  if (!q) { res.status(400).json({ error: "Missing required parameter: q" }); return false; }
  if (q.length > 200) { res.status(400).json({ error: "Query too long (max 200 characters)" }); return false; }
  return true;
}

function buildConfig(q) {
  const config = {
    language: "any",
    languages: [],
    deliveryCountries: ["US", "IN"],
    deliveryPincodes: { US: "19701", IN: "600028" },
    resultsPerCard: 5,
    soldListingsLimit: 5,
    soldBrowser: false,
    tcgBrowseCategoryIds: EBAY_CATEGORY_TCG_SINGLE_CARDS_US,
    listingFormat: "raw",
    rawSearchSuffix: "",
    slab: { provider: "PSA", grade: "10" },
    aiGrading: {
      enabled: false,
      mode: "llm",
      llm: { provider: "claude", model: "claude-opus-4-7", maxTokens: 500 },
      site: { provider: "local" },
      minGradeToReport: 0,
      cacheGrades: true,
    },
  };
  if (q.lang) {
    config.languages = parseListingLanguagesFromInput(q.lang);
    config.language = config.languages.length ? config.languages.join("+") : "any";
  }
  if (q.countries) config.deliveryCountries = q.countries.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  if (q.results) config.resultsPerCard = Math.max(1, Number(q.results));
  if (q.sold) config.soldListingsLimit = Math.max(1, Number(q.sold));
  if (q.format === "slab") config.listingFormat = "slab";
  if (q.slab_provider) config.slab.provider = q.slab_provider;
  if (q.slab_grade) config.slab.grade = q.slab_grade;
  if (q.condition) config.condition = q.condition.toUpperCase();
  if (q.source) config.source = q.source.toLowerCase();
  if (q.grade === "true" || q.grade === true) {
    config.aiGrading.enabled = true;
    if (q.provider) config.aiGrading.llm.provider = q.provider;
    if (q.model) config.aiGrading.llm.model = q.model;
  }
  return config;
}

async function storeGradeLog(record) {
  await saveGradeLog(record);
}

async function gradeItems(items, config, cardName, source) {
  return Promise.all(items.map(async (row) => {
    try {
      const extraImages = row.additionalImages || [];
      const g = await gradeImage(row.imageUrl, config, extraImages);
      if (g && !g.error) {
        await storeGradeLog({
          ts: new Date().toISOString(),
          cardName,
          source,
          listingId: row.itemId,
          imageUrl: row.imageUrl,
          extraImages: extraImages.map(e => e.imageUrl || e),
          provider: config.aiGrading.llm.provider,
          model: config.aiGrading.llm.model,
          grade: g,
          listingPrice: row.price,
          condition: row.condition,
        });
      }
      return { ...row, grade: g };
    } catch (e) {
      return { ...row, grade: { error: safeErrorMessage(e) } };
    }
  }));
}

// GET /api/demo — list available demo cards
app.get("/api/demo", (req, res) => {
  res.json({ cards: listDemoCards(), hint: "Use any of these with /api/search?q=...&demo=true" });
});

// GET /api/search
app.get("/api/search", apiAuthMiddleware, (req, res, next) => { req._errorType = "search"; next(); }, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;

  const wantDemo = req.query.demo === "true" || (!clientId && !clientSecret);
  if (wantDemo) {
    const demoResult = getDemoSearchResult(q, { source: req.query.source, condition: req.query.condition });
    for (const country of Object.keys(demoResult.activeByCountry || {})) {
      demoResult.activeByCountry[country] = flagPriceOutliers(demoResult.activeByCountry[country].map(item => ({
        ...item, detectedCondition: item.detectedCondition || detectCondition(item),
      })));
    }
    if (demoResult.sold?.length) recordSoldPrices(q, demoResult.sold, demoResult.source).catch(() => {});
    const demoIdentity = parseCardIdentity(q);
    if (demoIdentity.cardId) {
      demoResult.cardId = demoIdentity.cardId;
      demoResult.cardIdentity = { name: demoIdentity.name, setCode: demoIdentity.setCode, rarity: demoIdentity.rarity, setName: SET_NAME_MAP[demoIdentity.setCode] || null };
    }
    return res.json(demoResult);
  }

  try {
    const config = buildConfig(req.query);
    const source = config.source || "ebay";
    let result;

    if (source === "snkrdunk") {
      result = await searchSnkrdunk(q, config);
    } else if (source === "magi") {
      result = await searchMagi(q, config);
    } else if (source === "yahoo") {
      result = await searchYahooAuctions(q, config);
      for (const country of Object.keys(result.activeByCountry || {})) {
        result.activeByCountry[country] = filterRelevantResults(result.activeByCountry[country], result.ebaySearchQuery || q).filtered;
      }
      if (result.sold?.length) result.sold = filterRelevantResults(result.sold, result.ebaySearchQuery || q).filtered;
      result.counts = { activeTotal: Object.values(result.activeByCountry || {}).reduce((n, arr) => n + arr.length, 0), sold: result.sold?.length || 0 };
    } else {
      const ebayQuery = buildEbaySearchQuery(q, config);
      const cp = cachePrefix(req);
      config._cachePrefix = cp;
      const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
      const filteredByCountry = {};
      for (const [country, items] of Object.entries(activeRes.itemsByCountry || {})) {
        filteredByCountry[country] = filterRelevantResults(items, q).filtered;
      }

      searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false }).catch(() => {});
      getPsaGradingSignal(q, { _cachePrefix: cp }).catch(() => null);

      result = {
        query: q,
        source: "ebay",
        listingFormat: config.listingFormat,
        activeByCountry: filteredByCountry,
        sold: [],
        soldSource: "pending",
        psaSignal: null,
        counts: {
          activeTotal: Object.values(filteredByCountry).reduce((n, arr) => n + arr.length, 0),
          sold: 0,
        },
      };
    }

    const identity = parseCardIdentity(q);
    if (identity.cardId) {
      result.cardId = identity.cardId;
      result.cardIdentity = { name: identity.name, setCode: identity.setCode, rarity: identity.rarity, setName: SET_NAME_MAP[identity.setCode] || null };
    }

    if (config.aiGrading.enabled) {
      const allItems = [];
      for (const items of Object.values(result.activeByCountry || {})) allItems.push(...items);
      const graded = await gradeItems(allItems, config, q, source);
      const gradedMap = new Map(graded.map(g => [g.itemId, g]));
      for (const country of Object.keys(result.activeByCountry || {})) {
        result.activeByCountry[country] = result.activeByCountry[country].map(item => gradedMap.get(item.itemId) || item);
      }
    }

    // Add detected condition + flag outliers
    for (const country of Object.keys(result.activeByCountry || {})) {
      result.activeByCountry[country] = flagPriceOutliers(result.activeByCountry[country].map(item => ({
        ...item,
        detectedCondition: item.detectedCondition || detectCondition(item),
      })));
    }

    // Filter by condition if requested
    if (config.condition && result.activeByCountry) {
      for (const country of Object.keys(result.activeByCountry)) {
        result.activeByCountry[country] = filterByCondition(result.activeByCountry[country], config.condition);
      }
      result.counts.activeTotal = Object.values(result.activeByCountry).reduce((n, arr) => n + arr.length, 0);
    }

    if (result.sold?.length) recordSoldPrices(q, result.sold, result.source).catch(() => {});
    getOrCreateCard(q, { source: result.source, lang: config.language }).catch(() => {});
    trackSearchFrequency(q).catch(() => {});
    res.json(result);
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/sold
app.get("/api/sold", apiAuthMiddleware, (req, res, next) => { req._errorType = "sold"; next(); }, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;

  const wantSoldDemo = req.query.demo === "true" || (!clientId && !clientSecret);
  if (wantSoldDemo) {
    const d = getDemoSearchResult(q);
    return res.json({ query: q, sold: d.sold, soldSource: d.soldSource || "demo", counts: { sold: d.sold.length }, _demo: true });
  }

  try {
    const config = buildConfig(req.query);
    const source = config.source || "ebay";
    let sold = [], soldSource = source;

    if (source === "snkrdunk") {
      const r = await searchSnkrdunk(q, config);
      sold = r.sold;
    } else if (source === "magi") {
      const r = await searchMagi(q, config);
      sold = r.sold;
      soldSource = r.soldSource;
    } else if (source === "yahoo") {
      const r = await searchYahooAuctions(q, config);
      sold = filterRelevantResults(r.sold || [], r.ebaySearchQuery || q).filtered;
      soldSource = r.soldSource;
    } else {
      const ebayQuery = buildEbaySearchQuery(q, config);
      config._cachePrefix = cachePrefix(req);
      const soldRes = await Promise.race([
        searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false }),
        new Promise(r => setTimeout(() => r({ items: [], source: "timeout" }), 30000)),
      ]);
      sold = soldRes.items || [];
      soldSource = soldRes.source;
    }

    res.json({ query: q, sold, soldSource, counts: { sold: sold.length } });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/psa
app.get("/api/psa", apiAuthMiddleware, (req, res, next) => { req._errorType = "psa"; next(); }, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;
  try {
    if (req.query.demo === "true") {
      const demo = getDemoSearchResult(q, {});
      return res.json({ query: q, signal: demo.psaSignal || null, _demo: true });
    }
    const signal = await getPsaGradingSignal(q);
    res.json({ query: q, signal });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /api/grade
app.post("/api/grade", authMiddleware, (req, res, next) => { req._errorType = "grade"; next(); }, async (req, res) => {
  const { imageUrl, extraImages, provider, model, cardName, cardId, source, listingId, listingPrice, condition, centeringHint, passes: rawPasses } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "Missing required field: imageUrl" });
  const passes = Math.min(3, Math.max(1, Number(rawPasses) || 1));
  try {
    const extras = (extraImages || []).map(u => ({ imageUrl: u }));

    let grade;
    if (passes > 1) {
      const results = [];
      for (let i = 0; i < passes; i++) {
        const config = {
          aiGrading: {
            enabled: true,
            mode: "llm",
            llm: { provider: provider || "claude", model: model || "claude-opus-4-7", maxTokens: 500 },
            cacheGrades: false,
          },
        };
        const r = await gradeImage(imageUrl, config, extras, centeringHint);
        if (r && !r.error) results.push(r);
      }
      grade = results.length ? medianGrade(results) : { error: "All passes failed" };
    } else {
      const config = {
        aiGrading: {
          enabled: true,
          mode: "llm",
          llm: { provider: provider || "claude", model: model || "claude-opus-4-7", maxTokens: 500 },
          cacheGrades: true,
        },
      };
      grade = await gradeImage(imageUrl, config, extras, centeringHint);
    }

    let gradeId = null;
    if (grade && !grade.error) {
      const userId = portfolioUserId(req);
      gradeId = await storeGradeLog({
        ts: new Date().toISOString(),
        userId: userId || null,
        cardId: cardId || null,
        cardName: cardName || "unknown",
        source: source || "api",
        listingId: listingId || null,
        imageUrl,
        extraImages: extraImages || [],
        provider: (provider || "claude"),
        model: (model || "claude-opus-4-7"),
        grade,
        listingPrice: listingPrice || null,
        condition: condition || null,
      });
      if (passes === 1) {
        const { cacheGrade } = await import("./lib/grading/grading.js");
        const cacheConfig = { aiGrading: { mode: "llm", llm: { provider: provider || "claude", model: model || "claude-opus-4-7" }, cacheGrades: true } };
        await cacheGrade(imageUrl, cacheConfig, grade).catch(() => {});
      }
    }

    res.json({ grade, gradeId, stored: !!(grade && !grade.error) });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/grade/report/:id — shareable grade report as PNG
app.get("/api/grade/report/:id", async (req, res) => {
  try {
    const records = await getGradeLogs({ limit: 1, query: req.params.id });
    const record = records.find(r => r.id === req.params.id);
    if (!record?.grade || record.grade.error) return res.status(404).json({ error: "Grade not found" });

    const { default: sharp } = await import("sharp");
    const grade = record.grade;
    const overall = grade.overall || "?";
    const conf = Math.round((grade.confidence || 0) * 100);
    const dist = grade.gradeDistribution || {};
    const limiter = grade.notes || "";

    const scores = [
      ["Centering", grade.centering],
      ["Corners", grade.corners],
      ["Edges", grade.edges],
      ["Surface", grade.surface],
    ];

    const distLines = Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g, p]) => `PSA ${g}: ${p}%`)
      .join("  ·  ");

    const barsSvg = scores.map(([name, score], i) => {
      const y = 180 + i * 48;
      const barW = Math.round(((score || 0) / 10) * 260);
      const color = score >= 9 ? "#7ce0a8" : score >= 7 ? "#d9b676" : "#ff5d5d";
      return `
        <text x="30" y="${y}" fill="rgba(255,255,255,0.5)" font-size="14" font-family="sans-serif">${name}</text>
        <text x="320" y="${y}" fill="white" font-size="14" font-family="monospace" text-anchor="end">${score || "?"}</text>
        <rect x="30" y="${y + 6}" width="${barW}" height="4" rx="2" fill="${color}"/>
        <rect x="30" y="${y + 6}" width="260" height="4" rx="2" fill="rgba(255,255,255,0.05)"/>
        <rect x="30" y="${y + 6}" width="${barW}" height="4" rx="2" fill="${color}"/>`;
    }).join("");

    const svg = `<svg width="400" height="500" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="500" fill="#07070a"/>
      <rect x="15" y="15" width="370" height="470" rx="12" fill="#0c0d12" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      <text x="200" y="50" fill="#d9b676" font-size="12" font-family="sans-serif" text-anchor="middle" letter-spacing="2">CASECOMP AI GRADE</text>
      <text x="200" y="110" fill="white" font-size="56" font-family="sans-serif" font-weight="bold" text-anchor="middle">${overall}</text>
      <text x="200" y="135" fill="rgba(255,255,255,0.4)" font-size="12" font-family="sans-serif" text-anchor="middle">${conf}% confidence</text>
      <text x="200" y="158" fill="rgba(255,255,255,0.3)" font-size="11" font-family="monospace" text-anchor="middle">${distLines}</text>
      ${barsSvg}
      <text x="30" y="400" fill="rgba(255,255,255,0.25)" font-size="11" font-family="sans-serif">${limiter.substring(0, 60)}</text>
      <text x="200" y="460" fill="rgba(255,255,255,0.15)" font-size="10" font-family="sans-serif" text-anchor="middle">casecomp.xyz</text>
    </svg>`;

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/grades/mine — user's grade history
app.get("/api/grades/mine", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const grades = await getGradeLogsByUser(userId, { limit });
    res.json({ grades, count: grades.length });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /api/grades/:id — delete your grade
app.delete("/api/grades/:id", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const record = await getGradeLog(req.params.id);
    if (!record) return res.status(404).json({ error: "Grade not found" });
    if (record.userId !== userId && !isAdminUser(req)) return res.status(403).json({ error: "Not your grade" });
    await deleteGradeLog(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/grades
app.get("/api/grades", authMiddleware, async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  try {
    const records = await getGradeLogs({ limit, query: req.query.q, source: req.query.source });
    res.json(records);
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/errors
app.get("/api/errors", authMiddleware, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  try {
    const errors = await getErrorLogs({ limit });
    res.json({ errors, count: errors.length });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /api/errors — clear all error logs (owner only)
app.delete("/api/errors", ownerOnly, async (req, res) => {
  try {
    const cleared = await clearErrorLogs();
    res.json({ ok: true, cleared });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/analytics
app.get("/api/analytics", ownerOnly, async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  try {
    const stats = await getAnalytics({ days });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/grading-dataset/stats
app.get("/api/grading-dataset/stats", ownerOnly, async (req, res) => {
  try {
    const { getDatasetStats } = await import("./lib/cards/grading-dataset.js");
    const stats = await getDatasetStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/health
app.get("/api/health", async (req, res) => {
  const firestoreStatus = await getFirestoreStatus();
  let ebayUsage = null;
  try { ebayUsage = await getEbayUsageToday(); } catch {}
  const isOwner = getRequestToken(req) === process.env.CASECOMP_API_KEY;
  const cardDbLoaded = getAllSets().length > 0;
  const mem = process.memoryUsage();
  const secrets = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ebay: !!(clientId && clientSecret),
    jwt: !!process.env.CASECOMP_JWT_SECRET,
    together: !!(process.env.TOGETHER_API_KEY && process.env.TOGETHER_API_KEY.length > 20),
  };
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    firestore: firestoreStatus,
    cardDatabase: cardDbLoaded,
    secrets,
    ebay: { configured: secrets.ebay, ...(isOwner ? { usageToday: ebayUsage, dailyCap: DAILY_CAP } : {}) },
    ...(isOwner ? { memory: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) } } : {}),
  });
});

// POST /auth/google
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many auth attempts, try again later" } });
app.post("/auth/google", authLimiter, async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: "idToken required" });
  try {
    const gUser = await verifyGoogleToken(idToken);
    const jwt = generateJwt(gUser);

    let apiKey = null;
    const existingKeys = await listKeysByOwner(gUser.sub).catch(() => []);
    if (existingKeys.length === 0) {
      const newKey = await createApiKey({ label: `${gUser.name || gUser.email}'s key`, ownerId: gUser.sub }).catch(() => null);
      if (newKey) apiKey = { key: newKey.key, keyPrefix: newKey.keyPrefix, id: newKey.id, isNew: true };
    } else {
      apiKey = { keyPrefix: existingKeys[0].keyPrefix, id: existingKeys[0].id, isNew: false };
    }

    const isAdmin = gUser.sub === process.env.CASECOMP_ADMIN_SUB;
    res.json({ jwt, apiKey, isAdmin, user: { id: gUser.sub, email: gUser.email, name: gUser.name, picture: gUser.picture } });
  } catch (e) {
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// POST /api/upload-url — generate signed GCS upload URL
app.post("/api/upload-url", authMiddleware, async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename || !contentType) return res.status(400).json({ error: "filename and contentType required" });
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return res.status(400).json({ error: "Only JPEG, PNG, or WebP images allowed" });
  try {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage();
    const bucket = storage.bucket("casecomp-uploads");
    const userId = portfolioUserId(req);
    const key = `${userId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const file = bucket.file(key);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType,
    });
    const publicUrl = `https://storage.googleapis.com/casecomp-uploads/${key}`;
    res.json({ uploadUrl: url, imageUrl: publicUrl, key });
  } catch (e) {
    logError("upload", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

function isAdminUser(req) {
  const adminSub = process.env.CASECOMP_ADMIN_SUB;
  if (!adminSub) return isOwnerKey(req);
  const jwtPayload = verifyJwt(getRequestToken(req));
  return jwtPayload?.sub === adminSub || isOwnerKey(req);
}

// ── Developer self-serve ─────────────────────────────────────

// GET /api/developer/keys — list your API keys
app.get("/api/developer/keys", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const keys = await listKeysByOwner(userId);
    res.json({ keys, count: keys.length });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /api/developer/keys — create a new API key (max 3 per user)
app.post("/api/developer/keys", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const existing = await listKeysByOwner(userId);
    if (existing.length >= 3) return res.status(400).json({ error: "Maximum 3 keys per account" });
    const { label } = req.body || {};
    const key = await createApiKey({ label: label || "My key", ownerId: userId });
    res.status(201).json({ id: key.id, key: key.key, keyPrefix: key.keyPrefix, label: key.label, rateLimit: key.rateLimit });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /api/developer/keys/:id — revoke your API key
app.delete("/api/developer/keys/:id", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const key = await getApiKey(req.params.id);
    if (!key || key.ownerId !== userId) return res.status(404).json({ error: "Key not found" });
    await deleteApiKey(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /api/developer/keys/:id/rotate — rotate your key
app.post("/api/developer/keys/:id/rotate", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const key = await getApiKey(req.params.id);
    if (!key || key.ownerId !== userId) return res.status(404).json({ error: "Key not found" });
    const rotated = await rotateApiKey(req.params.id);
    res.json({ id: rotated.id, key: rotated.key, keyPrefix: rotated.keyPrefix });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/developer/stats — your usage stats
app.get("/api/developer/stats", authMiddleware, async (req, res) => {
  try {
    const userId = portfolioUserId(req);
    if (!userId) return res.status(401).json({ error: "Sign in required" });
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const [keys, usage] = await Promise.all([
      listKeysByOwner(userId),
      getAnalyticsByUser(userId, { days }),
    ]);
    const totalRequests = keys.reduce((sum, k) => sum + (k.requestCount || 0), 0);
    res.json({ keys: keys.length, totalRequests, usage });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// ── Admin key management (admin only) ────────────────────────

// GET /api/admin/keys — list ALL developer keys
app.get("/api/admin/keys", authMiddleware, async (req, res) => {
  if (!isAdminUser(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const keys = await listAllKeys();
    res.json({ keys, count: keys.length });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// PATCH /api/admin/keys/:id — update any key (toggle active, change rate limit)
app.patch("/api/admin/keys/:id", authMiddleware, async (req, res) => {
  if (!isAdminUser(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { active, rateLimit, label } = req.body || {};
    const updated = await updateApiKey(req.params.id, { active, rateLimit, label });
    if (!updated) return res.status(404).json({ error: "Key not found" });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /api/admin/keys/:id — delete any key
app.delete("/api/admin/keys/:id", authMiddleware, async (req, res) => {
  if (!isAdminUser(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const deleted = await deleteApiKey(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Key not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/autocomplete
app.get("/api/autocomplete", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
  if (q.length > 100) return res.status(400).json({ error: "Query too long (max 100 characters)" });
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
  const results = searchCards(q, limit);
  res.json({ results, count: results.length, query: q });
});

// GET /api/sets
app.get("/api/sets", (req, res) => {
  const sets = getAllSets();
  const era = req.query.era;
  const filtered = era ? sets.filter(s => s.era === era) : sets;
  res.json({ sets: filtered, count: filtered.length });
});

// GET /api/sets/:setCode
app.get("/api/sets/:setCode", (req, res) => {
  const result = getSetWithCards(req.params.setCode);
  if (!result) return res.status(404).json({ error: "Set not found" });
  res.json(result);
});

// ============ V1 API — Drop Intelligence ============

async function authMiddleware(req, res, next) {
  if (isLocal) return next();
  const ownerKey = process.env.CASECOMP_API_KEY;
  const sandboxKey = process.env.CASECOMP_SANDBOX_KEY;
  if (!ownerKey) return next();
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ error: "Invalid or missing API key" });
  if (token === ownerKey || token === sandboxKey) return next();
  const jwtPayload = verifyJwt(token);
  if (jwtPayload) return next();
  const devKey = await validateApiKey(token);
  if (devKey) {
    if (!devKey.active) return res.status(403).json({ error: "API key has been deactivated" });
    if (!checkKeyRateLimit(devKey.id, devKey.rateLimit || 60)) {
      return res.status(429).json({ error: `Rate limit exceeded (${devKey.rateLimit || 60} req/min)` });
    }
    req._devKey = devKey;
    return next();
  }
  return res.status(401).json({ error: "Invalid or missing API key" });
}

function ownerOnly(req, res, next) {
  if (isLocal) return next();
  const token = getRequestToken(req);
  if (token !== process.env.CASECOMP_API_KEY) {
    return res.status(403).json({ error: "Owner key required" });
  }
  next();
}

function apiAuthMiddleware(req, res, next) {
  if (req.query.demo === "true") return next();
  return authMiddleware(req, res, next);
}

const v1 = express.Router();
v1.use(authMiddleware);

// GET /v1/drops — list recent drop events
v1.get("/drops", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  try {
    const records = await getDrops({ limit, site: req.query.site, status: req.query.status });
    res.json({ drops: records, count: records.length, limit });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /v1/drops/:id — single drop with queue metrics
v1.get("/drops/:id", async (req, res) => {
  try {
    const record = await getDrop(req.params.id);
    if (!record) return res.status(404).json({ error: "Drop not found" });
    res.json(record);
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /v1/comps — sold and listed prices
v1.get("/comps", async (req, res) => {
  const { sku, q } = req.query;
  const query = sku || q;
  if (!query) return res.status(400).json({ error: "Missing required parameter: sku or q" });
  try {
    const config = buildConfig(req.query);
    const source = config.source || "ebay";
    let active = [], sold = [];

    if (source === "snkrdunk") {
      const r = await searchSnkrdunk(query, config);
      active = r.items || r.active || [];
      sold = r.sold || [];
    } else if (source === "magi") {
      const r = await searchMagi(query, config);
      active = r.items || r.active || [];
      sold = r.sold || [];
    } else if (source === "yahoo") {
      const r = await searchYahooAuctions(query, config);
      active = filterRelevantResults(r.items || r.active || Object.values(r.activeByCountry || {}).flat(), r.ebaySearchQuery || query).filtered;
      sold = filterRelevantResults(r.sold || [], r.ebaySearchQuery || query).filtered;
    } else {
      const ebayQuery = buildEbaySearchQuery(query, config);
      config._cachePrefix = cachePrefix(req);
      const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: query, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
      const soldRes = await searchSold({ query: ebayQuery, relevanceQuery: query, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false });
      for (const items of Object.values(activeRes.itemsByCountry || {})) active.push(...items);
      sold = soldRes.items || [];
    }

    res.json({
      query,
      source,
      active: { items: active, count: active.length },
      sold: { items: sold, count: sold.length },
    });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /v1/webhooks — register webhook
v1.post("/webhooks", async (req, res) => {
  const { url, events } = req.body;
  if (!url) return res.status(400).json({ error: "Missing required field: url" });
  const validEvents = ["drop.opened", "drop.closed", "queue.joined", "queue.advanced", "queue.through", "checkout.cleared", "captcha.detected", "listing.new"];
  const selectedEvents = (events || []).filter(e => validEvents.includes(e));
  if (!selectedEvents.length) return res.status(400).json({ error: `No valid events. Valid: ${validEvents.join(", ")}` });

  const webhook = {
    id: `wh_${Date.now().toString(36)}`,
    url,
    events: selectedEvents,
    createdAt: new Date().toISOString(),
    active: true,
  };
  await saveWebhook(webhook);
  res.status(201).json(webhook);
});

// GET /v1/webhooks — list registered webhooks
v1.get("/webhooks", async (req, res) => {
  try {
    const stored = await getWebhooks();
    res.json({ webhooks: stored, count: stored.length });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /v1/webhooks/:id — remove webhook
v1.delete("/webhooks/:id", async (req, res) => {
  await deleteWebhook(req.params.id);
  res.json({ ok: true, id: req.params.id });
});

app.use("/v1", v1);

// Helper: log a drop event (called from extension sync or internal)
app.post("/api/drop-event", authMiddleware, (req, res, next) => { req._errorType = "drop"; next(); }, async (req, res) => {
  const { site, status, detail, url, tabId } = req.body;
  if (!site || !status) return res.status(400).json({ error: "Missing site or status" });
  const drop = {
    id: `drp_${Date.now().toString(36)}`,
    ts: new Date().toISOString(),
    site, status, detail: detail || "", url: url || "", tabId: tabId || null,
  };
  try {
    await saveDrop(drop);
    const allWebhooks = await getWebhooks();
    const eventMap = { detected: "drop.opened", through: "queue.through", joined: "queue.joined", waiting: "queue.advanced", captcha: "captcha.detected", "atc-success": "checkout.cleared", "new-listing": "listing.new" };
    const event = eventMap[status];
    for (const wh of allWebhooks) {
      if (event && wh.active && wh.events.includes(event)) {
        fetch(wh.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, drop }) }).catch(() => {});
      }
    }
    res.json(drop);
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/card — look up card identity
app.get("/api/card", apiAuthMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;
  try {
    const card = await findCardByQuery(q);
    if (card) return res.json(card);

    let identity = parseCardIdentity(q);

    if (!identity.cardId) {
      const demo = getDemoSearchResult(q);
      const items = [];
      for (const arr of Object.values(demo.activeByCountry || {})) items.push(...arr);
      for (const item of items) {
        const fromTitle = parseCardIdentity(item.title);
        if (fromTitle.cardId) {
          identity = fromTitle;
          break;
        }
      }
    }

    if (identity.cardId) {
      identity.setName = SET_NAME_MAP[identity.setCode] || identity.setCode;
      if (identity.name && identity.setName && identity.name.includes(identity.setName)) {
        identity.name = identity.name.replace(identity.setName, "").replace(/\s+/g, " ").trim();
      }
      if (identity.name) {
        identity.name = identity.name
          .replace(/\[.*?\]|\(.*?\)/g, "")
          .replace(/\s*(Expansion Pack|High Class Pack|Booster|Collection)\b.*/i, "")
          .replace(/\s+[A-Z]\s*[-—]\s*(Mint|NM|LP|MP|HP)\s*$/i, "")
          .replace(/\s+/g, " ").trim();
      }
    }

    res.json({ ...identity, stored: false });
  } catch (e) {
    logError("card", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/card/share/:setCode/:number — bundled card data for share pages
app.get("/api/card/share/:setCode/:number", async (req, res) => {
  const cardId = `${req.params.setCode}/${req.params.number}`;
  const searchQuery = resolveCardIdToQuery(cardId);
  const numberQuery = req.params.number.replace("-", "/");

  function findDemo() {
    const byNumber = findDemoByNumber(req.params.number);
    if (byNumber) return byNumber;
    const d = getDemoSearchResult(searchQuery, {});
    if (d._demo && Object.values(d.activeByCountry || {}).flat().length > 0) return d;
    return getDemoSearchResult(numberQuery, {});
  }

  try {
    const demoResult = findDemo();
    const [card, search, priceData] = await Promise.all([
      findCardByQuery(searchQuery).catch(() => null),
      (async () => {
        return demoResult._demo ? demoResult : null;
      })(),
      (async () => {
        const sold = (demoResult.sold || []).filter(s => s.soldDate && s.price);
        const history = sold.map(s => ({ price: s.price, recordedAt: s.soldDate }));
        const prices = history.map(h => h.price);
        return {
          history,
          stats: prices.length ? {
            min: Math.min(...prices), max: Math.max(...prices),
            avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100,
            count: prices.length,
          } : null,
        };
      })(),
    ]);

    const identity = card || parseCardIdentity(searchQuery);
    if (identity.setCode) identity.setName = SET_NAME_MAP[identity.setCode] || identity.setCode;
    if (search?.query) {
      const fromQuery = parseCardIdentity(search.query);
      if (!identity.rarity && fromQuery.rarity) identity.rarity = fromQuery.rarity;
      if ((!identity.name || identity.name === identity.setName) && fromQuery.name) identity.name = fromQuery.name;
    }
    if (identity.name && identity.setName && identity.name.includes(identity.setName)) {
      identity.name = identity.name.replace(identity.setName, "").replace(/\s+/g, " ").trim();
    }

    const active = search ? Object.values(search.activeByCountry || {}).flat() : [];
    const lowestPrice = active.length ? Math.min(...active.map(i => i.totalCost || i.price)) : null;
    const lowestSource = lowestPrice && active.length
      ? active.find(i => (i.totalCost || i.price) === lowestPrice)
      : null;

    const sourceMap = {};
    for (const item of active) {
      const src = item.itemWebUrl?.includes("magi") ? "magi" : item.itemWebUrl?.includes("yahoo") ? "yahoo" : item.itemWebUrl?.includes("snkrdunk") ? "snkrdunk" : "ebay";
      if (!sourceMap[src]) sourceMap[src] = { count: 0, lowest: Infinity };
      sourceMap[src].count++;
      const p = item.totalCost || item.price;
      if (p < sourceMap[src].lowest) sourceMap[src].lowest = p;
    }

    res.json({
      cardId,
      identity,
      price: {
        lowest: lowestPrice,
        source: lowestSource?.itemWebUrl?.includes("magi") ? "magi" : lowestSource?.itemWebUrl?.includes("yahoo") ? "yahoo" : lowestSource?.itemWebUrl?.includes("snkrdunk") ? "snkrdunk" : "ebay",
        listingCount: active.length,
        currency: active[0]?.priceCurrency || "USD",
        bySources: sourceMap,
      },
      psaSignal: search?.psaSignal || null,
      priceHistory: priceData,
      searchQuery: search?.query || searchQuery,
    });
  } catch (e) {
    logError("card-share", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/sitemap — public sitemap of all indexable URLs
app.get("/api/sitemap", async (req, res) => {
  try {
    const now = new Date().toISOString();
    const base = "https://casecomp.xyz";

    const staticPages = [
      { url: `${base}/`, changefreq: "weekly", priority: 1.0, lastmod: now },
      { url: `${base}/search`, changefreq: "daily", priority: 0.9, lastmod: now },
      { url: `${base}/sets`, changefreq: "weekly", priority: 0.8, lastmod: now },
      { url: `${base}/portfolio`, changefreq: "daily", priority: 0.8, lastmod: now },
      { url: `${base}/developers`, changefreq: "monthly", priority: 0.6, lastmod: now },
      { url: `${base}/install`, changefreq: "monthly", priority: 0.5, lastmod: now },
    ];

    const setPages = getAllSets().map(s => ({
      url: `${base}/set/${s.setCode}`,
      changefreq: "weekly",
      priority: 0.7,
      lastmod: now,
    }));

    const cardPages = [];
    const seen = new Set();
    try {
      const { Firestore: FSLib } = await import("@google-cloud/firestore");
      const db = new FSLib();
      const snap = await db.collection("cards").orderBy("createdAt", "desc").limit(50000).get();
      for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.cardId || seen.has(data.cardId)) continue;
        seen.add(data.cardId);
        if (!data.cardId.includes("/")) continue;
        cardPages.push({
          url: `${base}/card/${data.cardId}`,
          changefreq: "daily",
          priority: 0.7,
          lastmod: data.updatedAt || data.createdAt || now,
        });
      }
    } catch {}

    const demoSlugs = ["sv8a/217-187", "m4/114-083", "m2a/234-193"];
    for (const slug of demoSlugs) {
      if (!seen.has(slug)) {
        cardPages.push({ url: `${base}/card/${slug}`, changefreq: "daily", priority: 0.7, lastmod: now });
      }
    }

    const pages = [...staticPages, ...setPages, ...cardPages];

    const format = req.query.format;
    if (format === "xml") {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${p.url}</loc>
    <lastmod>${p.lastmod.split("T")[0]}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;
      res.set("Content-Type", "application/xml");
      res.set("Cache-Control", "public, max-age=3600");
      return res.send(xml);
    }

    res.set("Cache-Control", "public, max-age=3600");
    res.json({ pages, count: pages.length });
  } catch (e) {
    logError("sitemap", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/card/view/:setCode/:number — card-centric view with raw + graded data
app.get("/api/card/view/:setCode/:number", apiAuthMiddleware, async (req, res) => {
  const cardId = `${req.params.setCode}/${req.params.number}`;
  const searchQuery = resolveCardIdToQuery(cardId);
  const numberQuery = req.params.number.replace("-", "/");
  const isDemo = req.query.demo === "true" || (!clientId && !clientSecret);
  const formatFilter = req.query.format || "both";

  try {
    function findDemo() {
      const byNumber = findDemoByNumber(req.params.number);
      if (byNumber) return byNumber;
      const d = getDemoSearchResult(searchQuery, {});
      if (d._demo && Object.values(d.activeByCountry || {}).flat().length > 0) return d;
      return getDemoSearchResult(numberQuery, {});
    }

    const cardData = await findCardByQuery(searchQuery).catch(() => null);
    const identity = cardData || parseCardIdentity(searchQuery);
    if (identity.setCode) identity.setName = SET_NAME_MAP[identity.setCode] || identity.setCode;

    const tcgCard = findCardByCardId(cardId);
    if (tcgCard) {
      if (!identity.name || identity.name === identity.setName) identity.name = tcgCard.name;
      if (!identity.rarity && tcgCard.rarity) identity.rarity = tcgCard.rarity;
      if (!identity.setName && tcgCard.setName) identity.setName = tcgCard.setName;
      identity.imageUrl = tcgCard.imageUrl || null;
      identity.nameJa = tcgCard.nameJa || null;
    }

    let rawResults = { active: [], sold: [] };
    let slabResults = { active: [], sold: [] };
    let psaSignal = null;

    if (isDemo) {
      const demo = findDemo();
      if (demo._demo) {
        const active = Object.values(demo.activeByCountry || {}).flat();
        rawResults.active = active.filter(i => !i.listingGradeLabel || i.listingGradeLabel === "Ungraded");
        slabResults.active = active.filter(i => i.listingGradeLabel && i.listingGradeLabel !== "Ungraded");
        rawResults.sold = (demo.sold || []).filter(s => !s.listingGradeLabel);
        slabResults.sold = (demo.sold || []).filter(s => s.listingGradeLabel);
        psaSignal = demo.psaSignal || null;
        if (demo.query) {
          const fromQuery = parseCardIdentity(demo.query);
          if (!identity.rarity && fromQuery.rarity) identity.rarity = fromQuery.rarity;
          if ((!identity.name || identity.name === identity.setName) && fromQuery.name) identity.name = fromQuery.name;
        }
      }
    } else {
      const q = searchQuery;
      const cp = cachePrefix(req);
      const soldTimeout = (p) => Promise.race([p, new Promise(r => setTimeout(() => r({ items: [], source: "timeout" }), 30000))]);
      const fetchOpts = { deliveryCountries: ["US", "IN"], languages: [], config: { _cachePrefix: cp }, refresh: false, noEbay: false, getToken, on401 };

      const jobs = [getPsaGradingSignal(q, { _cachePrefix: cp }).catch(() => null)];

      if (formatFilter !== "slab") {
        const ebayRawQuery = buildEbaySearchQuery(q, { listingFormat: "raw" });
        jobs.push(
          searchActive({ query: ebayRawQuery, relevanceQuery: q, ...fetchOpts }).catch(() => ({ itemsByCountry: {} })),
          soldTimeout(searchSold({ query: ebayRawQuery, relevanceQuery: q, languages: [], config: { _cachePrefix: cp }, refresh: false, noEbay: false, getToken, on401, soldBrowser: false })).catch(() => ({ items: [] })),
        );
      }
      if (formatFilter !== "raw") {
        const ebaySlabQuery = buildEbaySearchQuery(q, { listingFormat: "slab", slab: { provider: "PSA", grade: "10" } });
        jobs.push(
          searchActive({ query: ebaySlabQuery, relevanceQuery: q, ...fetchOpts }).catch(() => ({ itemsByCountry: {} })),
          soldTimeout(searchSold({ query: ebaySlabQuery, relevanceQuery: q, languages: [], config: { _cachePrefix: cp }, refresh: false, noEbay: false, getToken, on401, soldBrowser: false })).catch(() => ({ items: [] })),
        );
      }

      const results = await Promise.all(jobs);
      psaSignal = results[0];
      let idx = 1;
      if (formatFilter !== "slab") {
        rawResults.active = filterRelevantResults(Object.values(results[idx]?.itemsByCountry || {}).flat(), q).filtered;
        rawResults.sold = filterRelevantResults(results[idx + 1]?.items || [], q).filtered;
        idx += 2;
      }
      if (formatFilter !== "raw") {
        slabResults.active = filterRelevantResults(Object.values(results[idx]?.itemsByCountry || {}).flat(), q).filtered;
        slabResults.sold = filterRelevantResults(results[idx + 1]?.items || [], q).filtered;
      }
    }

    const rawPrices = rawResults.active.map(i => i.totalCost || i.price).filter(Boolean).sort((a, b) => a - b);
    const slabPrices = slabResults.active.map(i => i.totalCost || i.price).filter(Boolean).sort((a, b) => a - b);
    const gradingCost = psaSignal?.estCost ? parseInt(psaSignal.estCost.replace(/\D/g, "")) || 50 : 50;
    const rawMedian = rawPrices.length ? rawPrices[Math.floor(rawPrices.length / 2)] : null;
    const slabMedian = slabPrices.length ? slabPrices[Math.floor(slabPrices.length / 2)] : null;
    const gradingRoi = rawMedian && slabMedian ? {
      rawMedian,
      slabMedian,
      gradingCost,
      expectedProfit: Math.round((slabMedian - rawMedian - gradingCost) * 100) / 100,
      spreadPercent: Math.round(((slabMedian - rawMedian) / rawMedian) * 100),
      verdict: slabMedian > rawMedian + gradingCost ? "worth_grading" : "not_worth_grading",
    } : null;

    trackSearchFrequency(searchQuery).catch(() => {});

    res.json({
      cardId,
      identity,
      raw: {
        active: rawResults.active,
        sold: rawResults.sold,
        counts: { active: rawResults.active.length, sold: rawResults.sold.length },
        priceRange: rawPrices.length ? { low: rawPrices[0], high: rawPrices[rawPrices.length - 1], median: rawMedian } : null,
      },
      graded: {
        active: slabResults.active,
        sold: slabResults.sold,
        counts: { active: slabResults.active.length, sold: slabResults.sold.length },
        priceRange: slabPrices.length ? { low: slabPrices[0], high: slabPrices[slabPrices.length - 1], median: slabMedian } : null,
      },
      psaSignal,
      gradingRoi,
      searchQuery,
      _demo: isDemo || undefined,
    });
  } catch (e) {
    logError("card-view", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /api/price-history — historical sold prices for a card
app.get("/api/price-history", apiAuthMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));

  const wantDemo = req.query.demo === "true" || (!clientId && !clientSecret);
  if (wantDemo) {
    const demoResult = getDemoSearchResult(q, {});
    const sold = demoResult.sold || [];
    const history = sold.filter(s => s.soldDate && s.price).map(s => ({
      price: s.price,
      recordedAt: s.soldDate,
      source: s.itemWebUrl?.includes("magi") ? "magi" : s.itemWebUrl?.includes("yahoo") ? "yahoo" : s.itemWebUrl?.includes("snkrdunk") ? "snkrdunk" : "ebay",
    }));
    const prices = history.map(h => h.price);
    const stats = prices.length ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100,
      count: prices.length,
    } : null;
    const trend = computePriceTrend(history);
    return res.json({ query: q, days, history, stats, trend, _demo: true });
  }

  try {
    let history = await getPriceHistory(q, { days });
    let tcgData = null;

    const tcg = await seedFromTCGPlayer(q);
    if (tcg) {
      tcgData = {
        productId: tcg.productId,
        name: tcg.name,
        setName: tcg.setName,
        marketPrice: tcg.price,
        listedMedianPrice: tcg.listedMedianPrice,
        printingType: tcg.printingType,
        source: "tcgplayer",
      };

      if (!history.length) {
        await recordSoldPrices(q, [{
          itemId: `tcg_${tcg.productId}`,
          price: tcg.price,
          priceCurrency: "USD",
          title: tcg.name,
          soldDate: new Date().toISOString().split("T")[0],
        }], "tcgplayer");
        history = await getPriceHistory(q, { days });
      }
    }

    const prices = history.map(h => h.price).filter(Boolean);
    const stats = prices.length ? {
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length * 100) / 100,
      count: prices.length,
    } : null;

    if (tcgData && stats) {
      const ratio = tcgData.marketPrice / stats.avg;
      if (ratio < 0.3 || ratio > 3) tcgData = null;
    }

    const trend = computePriceTrend(history);
    res.json({ query: q, days, history, stats, trend, tcgplayer: tcgData });
  } catch (e) {
    logError("price-history", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.post("/api/alerts", authMiddleware, async (req, res) => {
  const { email, targetPrice, query, type, spreadThreshold } = req.body;
  if (!email || !query) return res.status(400).json({ error: "Missing email or query" });
  const alertType = type === "arbitrage" ? "arbitrage" : "price";
  try {
    const alert = {
      email,
      query,
      type: alertType,
      createdAt: new Date().toISOString(),
    };
    if (alertType === "price") {
      alert.targetPrice = targetPrice || null;
    } else {
      alert.spreadThreshold = spreadThreshold != null ? Number(spreadThreshold) : 10;
    }
    await saveAlert(alert);
    res.json({ ok: true });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/alerts", authMiddleware, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: "Missing email" });
  try {
    const alerts = await getAlertsByEmail(email);
    res.json({ alerts, count: alerts.length });
  } catch (e) {
    logError("alerts", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.post("/api/check-alerts", ownerOnly, async (req, res) => {
  try {
    const alerts = await getActiveAlerts();
    const triggered = [];
    const checked = [];

    const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

    for (const alert of alerts) {
      try {
        const now = new Date().toISOString();
        await updateAlert(alert.id, { lastChecked: now });

        const recentlyTriggered = alert.lastTriggered && (Date.now() - new Date(alert.lastTriggered).getTime()) < SIX_HOURS_MS;

        if (alert.type === "arbitrage") {
          const sources = ["ebay", "magi", "yahoo", "snkrdunk"];
          const pricesBySource = {};

          for (const source of sources) {
            try {
              let data;
              const config = buildConfig({ source });
              config._cachePrefix = "";
              if (source === "snkrdunk") {
                data = await searchSnkrdunk(alert.query, config);
              } else if (source === "magi") {
                data = await searchMagi(alert.query, config);
              } else if (source === "yahoo") {
                data = await searchYahooAuctions(alert.query, config);
              } else {
                const ebayQuery = buildEbaySearchQuery(alert.query, config);
                const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: alert.query, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
                data = { activeByCountry: activeRes.itemsByCountry || {}, source: "ebay" };
              }
              let items = [];
              for (const arr of Object.values(data.activeByCountry || {})) items.push(...arr);
              if (source === "yahoo") items = filterRelevantResults(items, data.ebaySearchQuery || alert.query).filtered;
              if (items.length) {
                const prices = items.map(i => i.totalCost || i.price).filter(Boolean).sort((a, b) => a - b);
                pricesBySource[source] = { lowest: prices[0], count: prices.length };
              }
            } catch {}
          }

          const sourceNames = Object.keys(pricesBySource);
          if (sourceNames.length >= 2) {
            const sorted = sourceNames.sort((a, b) => pricesBySource[a].lowest - pricesBySource[b].lowest);
            const cheapest = sorted[0];
            const most = sorted[sorted.length - 1];
            const spread = Math.round((pricesBySource[most].lowest - pricesBySource[cheapest].lowest) * 100) / 100;
            const spreadPct = Math.round((spread / pricesBySource[most].lowest) * 100);
            const threshold = alert.spreadThreshold || 10;
            if (spreadPct >= threshold) {
              const triggerData = {
                alertId: alert.id,
                type: "arbitrage",
                email: alert.email,
                query: alert.query,
                cheapestSource: cheapest,
                cheapestPrice: pricesBySource[cheapest].lowest,
                mostExpensiveSource: most,
                mostExpensivePrice: pricesBySource[most].lowest,
                spread,
                spreadPct,
                threshold,
              };
              triggered.push(triggerData);
              if (!recentlyTriggered) {
                const emailResult = await sendAlertEmail(alert, triggerData).catch(() => ({ sent: false }));
                const ts = new Date().toISOString();
                await updateAlert(alert.id, { lastTriggered: ts, lastNotified: ts, lastEmailResult: emailResult }).catch(() => {});
              }
            }
          }

          checked.push({ alertId: alert.id, type: "arbitrage", query: alert.query });
        } else {
          const config = buildConfig({});
          config._cachePrefix = "";
          const ebayQuery = buildEbaySearchQuery(alert.query, config);
          let lowestPrice = null;

          try {
            const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: alert.query, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
            const items = [];
            for (const arr of Object.values(activeRes.itemsByCountry || {})) items.push(...arr);
            const prices = items.map(i => i.totalCost || i.price).filter(Boolean).sort((a, b) => a - b);
            if (prices.length) lowestPrice = prices[0];
          } catch {}

          if (lowestPrice != null && alert.targetPrice != null && lowestPrice <= alert.targetPrice) {
            const triggerData = {
              alertId: alert.id,
              type: "price",
              email: alert.email,
              query: alert.query,
              currentPrice: lowestPrice,
              targetPrice: alert.targetPrice,
            };
            triggered.push(triggerData);
            if (!recentlyTriggered) {
              const emailResult = await sendAlertEmail(alert, triggerData).catch(() => ({ sent: false }));
              const ts = new Date().toISOString();
              await updateAlert(alert.id, { lastTriggered: ts, lastNotified: ts, lastEmailResult: emailResult }).catch(() => {});
            }
          }

          checked.push({ alertId: alert.id, type: "price", query: alert.query, currentPrice: lowestPrice });
        }
      } catch (e) {
        checked.push({ alertId: alert.id, query: alert.query, error: safeErrorMessage(e) });
      }
    }

    res.json({ checked: checked.length, triggered: triggered.length, results: triggered, details: checked });
  } catch (e) {
    logError("check-alerts", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// ============ Portfolio ============

const DEMO_PORTFOLIO = [
  { cardId: "sv8a/217-187", query: "Umbreon ex SAR 217/187", addedAt: "2026-04-20T10:00:00Z", purchasePrice: 370, purchaseSource: "ebay", quantity: 1, notes: "" },
  { cardId: "m4/114-083", query: "Mega Greninja ex SAR", addedAt: "2026-04-22T14:30:00Z", purchasePrice: 310, purchaseSource: "snkrdunk", quantity: 1, notes: "" },
  { cardId: "m2a/234-193", query: "Pikachu ex SAR 234/193 PSA 10", addedAt: "2026-04-25T09:15:00Z", purchasePrice: 720, purchaseSource: "magi", quantity: 1, notes: "" },
];

const DEMO_CURRENT_PRICES = {
  "sv8a/217-187": { currentPrice: 400, source: "ebay" },
  "m4/114-083": { currentPrice: 384, source: "snkrdunk" },
  "m2a/234-193": { currentPrice: 741, source: "magi" },
};

function portfolioUserId(req) {
  const token = getRequestToken(req);
  if (!token) return isLocal ? "local-dev" : null;
  const jwtPayload = verifyJwt(token);
  if (jwtPayload) return jwtPayload.sub;
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function calculatePortfolioStats(cards) {
  const totalCost = cards.reduce((sum, c) => sum + (c.purchasePrice || 0) * (c.quantity || 1), 0);
  const totalValue = cards.reduce((sum, c) => sum + (c.currentPrice || 0) * (c.quantity || 1), 0);
  const totalROI = totalValue - totalCost;
  const roiPercent = totalCost > 0 ? Math.round((totalROI / totalCost) * 10000) / 100 : 0;
  return { totalValue: Math.round(totalValue * 100) / 100, totalCost: Math.round(totalCost * 100) / 100, totalROI: Math.round(totalROI * 100) / 100, roiPercent };
}

function getDemoPortfolioCards() {
  return DEMO_PORTFOLIO.map(card => {
    const prices = DEMO_CURRENT_PRICES[card.cardId] || {};
    const currentPrice = prices.currentPrice || 0;
    const roi = card.purchasePrice > 0 ? Math.round(((currentPrice - card.purchasePrice) / card.purchasePrice) * 10000) / 100 : 0;
    return { ...card, currentPrice, currentSource: prices.source || "", roi };
  });
}

async function enrichPortfolioCards(cards) {
  return Promise.all(cards.map(async (card) => {
    let currentPrice = 0;
    let currentSource = "";
    try {
      const history = await getPriceHistory(card.query, { days: 30 });
      if (history.length) {
        currentPrice = history[0].price;
        currentSource = history[0].source || "";
      }
    } catch {}
    const roi = card.purchasePrice > 0 ? Math.round(((currentPrice - card.purchasePrice) / card.purchasePrice) * 10000) / 100 : 0;
    return { ...card, currentPrice, currentSource, roi };
  }));
}

function getDemoPortfolioHistory(days) {
  const history = [];
  let totalValue = 1525;
  const totalCost = 1400;
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split("T")[0];
    const modifier = 1 - ((i * 37 + 13) % 100) / 100 * 0.002 - 0.003;
    history.unshift({ date, totalValue: Math.round(totalValue * 100) / 100, totalCost });
    totalValue = totalValue * modifier;
  }
  return history;
}

function getDemoGainersLosers() {
  return {
    gainers: [
      { cardId: "m4/114-083", query: "Mega Greninja ex SAR", currentPrice: 384, priceNDaysAgo: 298.46, changePercent: 28.65, changeDollars: 85.54 },
      { cardId: "sv8a/217-187", query: "Umbreon ex SAR 217/187", currentPrice: 400, priceNDaysAgo: 385, changePercent: 3.90, changeDollars: 15 },
    ],
    losers: [
      { cardId: "m2a/234-193", query: "Pikachu ex SAR 234/193 PSA 10", currentPrice: 741, priceNDaysAgo: 748, changePercent: -0.94, changeDollars: -7 },
    ],
  };
}

async function calculateGainersLosers(cards, lookbackDays) {
  const cardChanges = await Promise.all(cards.map(async (card) => {
    let priceNDaysAgo = card.purchasePrice;
    try {
      const history = await getPriceHistory(card.query, { days: lookbackDays });
      if (history.length) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - lookbackDays);
        let closest = history[history.length - 1];
        let closestDiff = Infinity;
        for (const entry of history) {
          const entryDate = new Date(entry.recordedAt || entry.date);
          const diff = Math.abs(entryDate - cutoff);
          if (diff < closestDiff) {
            closestDiff = diff;
            closest = entry;
          }
        }
        priceNDaysAgo = closest.price;
      }
    } catch {}
    const currentPrice = card.currentPrice || 0;
    const changePercent = priceNDaysAgo > 0 ? Math.round(((currentPrice - priceNDaysAgo) / priceNDaysAgo) * 10000) / 100 : 0;
    const changeDollars = Math.round((currentPrice - priceNDaysAgo) * 100) / 100;
    return { cardId: card.cardId, query: card.query, currentPrice, priceNDaysAgo, changePercent, changeDollars };
  }));
  cardChanges.sort((a, b) => b.changePercent - a.changePercent);
  return {
    gainers: cardChanges.filter(c => c.changePercent > 0).slice(0, 3),
    losers: cardChanges.filter(c => c.changePercent <= 0).slice(-3).reverse(),
  };
}

app.get("/api/portfolio/summary", apiAuthMiddleware, async (req, res) => {
  const isDemo = req.query.demo === "true";
  const lookbackDays = Math.min(90, Math.max(1, Number(req.query.lookback) || 7));

  try {
    let cards;
    if (isDemo) {
      cards = getDemoPortfolioCards();
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      const raw = await getPortfolio(userId);
      cards = await enrichPortfolioCards(raw);
    }

    const stats = calculatePortfolioStats(cards);
    let bestPerformer = null;
    let worstPerformer = null;
    for (const c of cards) {
      if (!bestPerformer || c.roi > bestPerformer.roi) bestPerformer = c;
      if (!worstPerformer || c.roi < worstPerformer.roi) worstPerformer = c;
    }

    const { gainers, losers } = isDemo ? getDemoGainersLosers() : await calculateGainersLosers(cards, lookbackDays);

    res.json({
      totalCards: cards.reduce((n, c) => n + (c.quantity || 1), 0),
      uniqueCards: cards.length,
      ...stats,
      bestPerformer: bestPerformer ? { cardId: bestPerformer.cardId, query: bestPerformer.query, roi: bestPerformer.roi } : null,
      worstPerformer: worstPerformer ? { cardId: worstPerformer.cardId, query: worstPerformer.query, roi: worstPerformer.roi } : null,
      gainers,
      losers,
      lookbackDays,
      _demo: isDemo || undefined,
    });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/portfolio/history", apiAuthMiddleware, async (req, res) => {
  const isDemo = req.query.demo === "true";
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));

  try {
    let history;
    if (isDemo) {
      history = getDemoPortfolioHistory(days);
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      history = await getPortfolioSnapshots(userId, { days });
    }

    res.json({ history, days, _demo: isDemo || undefined });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/portfolio/export", apiAuthMiddleware, async (req, res) => {
  const format = req.query.format;
  if (format !== "csv") return res.status(400).json({ error: "Unsupported format. Only csv is supported." });

  const isDemo = req.query.demo === "true";

  try {
    let cards;
    if (isDemo) {
      cards = getDemoPortfolioCards();
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      const raw = await getPortfolio(userId);
      cards = await enrichPortfolioCards(raw);
    }

    const header = csvRow(["Card ID", "Name", "Set", "Rarity", "Purchase Price", "Purchase Source", "Current Price", "ROI %", "Quantity", "Added Date"]);
    const rows = cards.map(card => {
      const identity = parseCardIdentity(card.query);
      const setName = SET_NAME_MAP[identity.setCode] || identity.setCode || "";
      return csvRow([
        card.cardId,
        identity.name || "",
        setName,
        identity.rarity || "",
        card.purchasePrice != null ? card.purchasePrice.toFixed(2) : "0.00",
        card.purchaseSource || "",
        card.currentPrice != null ? card.currentPrice.toFixed(2) : "0.00",
        card.roi != null ? card.roi.toFixed(2) : "0.00",
        card.quantity || 1,
        card.addedAt || "",
      ]);
    });

    const date = new Date().toISOString().split("T")[0];
    const csv = "﻿" + [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="casecomp-portfolio-${date}.csv"`);
    res.send(csv);
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/portfolio/grading-opportunities", apiAuthMiddleware, async (req, res) => {
  const isDemo = req.query.demo === "true";

  try {
    let cards;
    if (isDemo) {
      cards = getDemoPortfolioCards();
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      const raw = await getPortfolio(userId);
      cards = await enrichPortfolioCards(raw);
    }

    const opportunities = [];
    const skipped = [];

    for (const card of cards) {
      if (isGradedCard(card.query)) {
        skipped.push({ cardId: card.cardId, query: card.query, reason: "already_graded" });
        continue;
      }

      let psaSignal = null;
      if (isDemo) {
        const demoData = getDemoResult(card.query);
        psaSignal = demoData?.psaSignal || null;
      }

      if (!psaSignal) {
        opportunities.push({
          cardId: card.cardId,
          query: card.query,
          currentRawPrice: card.currentPrice,
          estimatedGradedValue: null,
          gradingCost: null,
          expectedProfit: null,
          verdict: "no_data",
          gem10Pct: null,
          difficulty: null,
          tier: null,
          estCost: null,
          totalPop: null,
          pop10: null,
        });
        continue;
      }

      const gradingCost = parseFloat((psaSignal.estCost || "").replace(/[^0-9.]/g, "")) || 0;
      const gem10Pct = psaSignal.gem10Pct || 0;
      const multiplier = gem10Pct >= 50 ? 1.8 : gem10Pct >= 30 ? 1.3 : 1.1;
      const estimatedGradedValue = Math.round(card.currentPrice * multiplier * 100) / 100;
      const expectedProfit = Math.round((estimatedGradedValue - card.currentPrice - gradingCost) * 100) / 100;
      const verdict = expectedProfit > 0 && gem10Pct >= 50 ? "worth_grading" : expectedProfit > 0 ? "marginal" : "not_worth_grading";

      opportunities.push({
        cardId: card.cardId,
        query: card.query,
        currentRawPrice: card.currentPrice,
        estimatedGradedValue,
        gradingCost,
        expectedProfit,
        verdict,
        gem10Pct,
        difficulty: psaSignal.difficulty || null,
        tier: psaSignal.tier || null,
        estCost: psaSignal.estCost || null,
        totalPop: psaSignal.totalPop || null,
        pop10: psaSignal.pop10 || null,
      });
    }

    opportunities.sort((a, b) => (b.expectedProfit || 0) - (a.expectedProfit || 0));

    res.json({ opportunities, skipped, _demo: isDemo || undefined });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/portfolio/set/:setCode", apiAuthMiddleware, async (req, res) => {
  const isDemo = req.query.demo === "true";
  const setCode = req.params.setCode.toLowerCase();

  try {
    const setData = getSetWithCards(setCode);
    if (!setData) return res.status(404).json({ error: "Set not found" });

    const setCardIds = new Set(setData.cards.map(c => c.cardId).filter(Boolean));

    let portfolioCards;
    if (isDemo) {
      portfolioCards = DEMO_PORTFOLIO;
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      portfolioCards = await getPortfolio(userId);
    }

    const ownedCardIds = portfolioCards.map(c => c.cardId).filter(id => setCardIds.has(id));

    res.json({
      setCode,
      ownedCardIds,
      ownedCount: ownedCardIds.length,
      totalCards: setData.totalCards,
      _demo: isDemo || undefined,
    });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.get("/api/portfolio", apiAuthMiddleware, async (req, res) => {
  const isDemo = req.query.demo === "true";

  try {
    let cards;
    if (isDemo) {
      cards = getDemoPortfolioCards();
    } else {
      const userId = portfolioUserId(req);
      if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });
      const raw = await getPortfolio(userId);
      cards = await enrichPortfolioCards(raw);
    }

    const stats = calculatePortfolioStats(cards);
    res.json({ cards, ...stats, _demo: isDemo || undefined });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.post("/api/portfolio", authMiddleware, async (req, res) => {
  const { cardId, query, purchasePrice, purchaseSource, quantity } = req.body;
  if (!cardId || !/^[a-z0-9.]+\/[\d]+-[\d]+$/i.test(cardId)) {
    return res.status(400).json({ error: "Invalid or missing cardId. Format: setCode/number-total (e.g. sv8a/217-187)" });
  }

  const userId = portfolioUserId(req);
  if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });

  try {
    const card = await addToPortfolio(userId, {
      cardId,
      query: query || "",
      purchasePrice: purchasePrice != null ? Number(purchasePrice) : 0,
      purchaseSource: purchaseSource || "",
      quantity: quantity != null ? Number(quantity) : 1,
    });
    res.status(201).json({ ok: true, card });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.delete("/api/portfolio/:cardId", authMiddleware, async (req, res) => {
  const cardId = decodeURIComponent(req.params.cardId);
  const userId = portfolioUserId(req);
  if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });

  try {
    const removed = await removeFromPortfolio(userId, cardId);
    if (!removed) return res.status(404).json({ error: "Card not found in portfolio" });
    res.json({ ok: true, cardId });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.patch("/api/portfolio/:cardId", authMiddleware, async (req, res) => {
  const cardId = decodeURIComponent(req.params.cardId);
  const userId = portfolioUserId(req);
  if (!userId) return res.status(401).json({ error: "Invalid or missing API key" });

  try {
    const updated = await updatePortfolioCard(userId, cardId, req.body);
    if (!updated) return res.status(404).json({ error: "Card not found in portfolio" });
    res.json({ ok: true, card: updated });
  } catch (e) {
    logError("portfolio", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /api/track-prices — scheduled job to record prices for tracked cards
app.post("/api/track-prices", authMiddleware, async (req, res) => {
  const defaultCards = [
    "Pikachu ex SAR 234/193 PSA 10",
    "Umbreon ex SAR 217/187",
    "Mega Greninja ex SAR",
  ];

  let alertCards = [];
  try {
    const alerts = await getActiveAlerts();
    alertCards = [...new Set(alerts.map(a => a.query).filter(Boolean))];
  } catch {}

  let portfolioQueries = [];
  try {
    const userIds = await listPortfolioUserIds();
    for (const uid of userIds.slice(0, 100)) {
      const pCards = await getPortfolio(uid);
      portfolioQueries.push(...pCards.map(c => c.query).filter(Boolean));
    }
  } catch {}

  const cards = req.body?.cards || [...new Set([...defaultCards, ...alertCards, ...portfolioQueries])];
  const hasEbay = !!(clientId && clientSecret);
  const results = [];
  for (const card of cards) {
    try {
      let ebaySold = [];
      let magiSold = [];
      let usedDemo = false;

      if (hasEbay) {
        try {
          const ebayQuery = buildEbaySearchQuery(card, {});
          const warmConfig = { deliveryCountries: ["US", "IN"], languages: [], _cachePrefix: "" };
          const [soldRes] = await Promise.all([
            Promise.race([
              searchSold({ query: ebayQuery, relevanceQuery: card, languages: [], config: {}, refresh: false, noEbay: false, getToken, on401, soldBrowser: false }),
              new Promise(r => setTimeout(() => r({ items: [], source: "timeout" }), 30000)),
            ]),
            searchActive({ query: ebayQuery, relevanceQuery: card, deliveryCountries: warmConfig.deliveryCountries, languages: warmConfig.languages, config: warmConfig, refresh: false, noEbay: false, getToken, on401 }).catch(() => null),
            getPsaGradingSignal(card, { _cachePrefix: "" }).catch(() => null),
          ]);
          ebaySold = soldRes.items || [];
          if (ebaySold.length) {
            await recordSoldPrices(card, ebaySold, "ebay");
            saveGradedImages(ebaySold, "ebay").catch(() => {});
          }
        } catch (e) {
          logError("track-prices", `eBay fetch failed for "${card}": ${e.message}`, "/api/track-prices");
        }
      }

      try {
        const magiRes = await searchMagi(card, {});
        magiSold = magiRes.sold || [];
        if (magiSold.length) {
          await recordSoldPrices(card, magiSold, "magi");
        }
      } catch (e) {
        logError("track-prices", `Magi fetch failed for "${card}": ${e.message}`, "/api/track-prices");
      }

      if (!ebaySold.length && !magiSold.length) {
        const demoResult = getDemoSearchResult(card);
        if (demoResult.sold?.length) {
          await recordSoldPrices(card, demoResult.sold, demoResult.source);
          usedDemo = true;
          ebaySold = demoResult.sold;
        }
      }

      const total = ebaySold.length + magiSold.length;
      results.push({
        card,
        recorded: total,
        sources: {
          ebay: ebaySold.length,
          magi: magiSold.length,
        },
        usedDemo,
        lastTracked: new Date().toISOString(),
      });
    } catch (e) {
      results.push({ card, error: safeErrorMessage(e), lastTracked: new Date().toISOString() });
    }
  }
  let portfolioSnapshots = 0;
  try {
    const userIds = await listPortfolioUserIds();
    const capped = userIds.slice(0, 100);
    for (const uid of capped) {
      try {
        const raw = await getPortfolio(uid);
        if (!raw.length) continue;
        const enriched = await enrichPortfolioCards(raw);
        const stats = calculatePortfolioStats(enriched);
        const today = new Date().toISOString().split("T")[0];
        await savePortfolioSnapshot(uid, {
          date: today,
          totalValue: stats.totalValue,
          totalCost: stats.totalCost,
          cardCount: enriched.length,
          snapshotAt: new Date().toISOString(),
        });
        portfolioSnapshots++;
      } catch {}
    }
  } catch {}

  const alreadyWarmed = new Set(cards.map(c => c.toLowerCase().trim()));
  let portfolioWarmed = 0;
  let frequencyWarmed = 0;

  if (hasEbay) {
    try {
      const userIds = await listPortfolioUserIds();
      const uniquePortfolioQueries = new Set();
      for (const uid of userIds.slice(0, 100)) {
        try {
          const raw = await getPortfolio(uid);
          for (const card of raw) {
            if (card.query && !alreadyWarmed.has(card.query.toLowerCase().trim())) {
              uniquePortfolioQueries.add(card.query);
            }
          }
        } catch {}
      }
      const portfolioCards = [...uniquePortfolioQueries].slice(0, 20);
      for (const q of portfolioCards) {
        try {
          const ebayQuery = buildEbaySearchQuery(q, {});
          await searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: ["US", "IN"], languages: [], config: { _cachePrefix: "" }, refresh: false, noEbay: false, getToken, on401 }).catch(() => null);
          alreadyWarmed.add(q.toLowerCase().trim());
          portfolioWarmed++;
        } catch {}
      }
    } catch {}

    try {
      const topSearched = await getTopSearchedCards(10 + alreadyWarmed.size);
      const toWarm = topSearched.filter(s => !alreadyWarmed.has(s.query.toLowerCase().trim())).slice(0, 10);
      for (const entry of toWarm) {
        try {
          const ebayQuery = buildEbaySearchQuery(entry.query, {});
          await searchActive({ query: ebayQuery, relevanceQuery: entry.query, deliveryCountries: ["US", "IN"], languages: [], config: { _cachePrefix: "" }, refresh: false, noEbay: false, getToken, on401 }).catch(() => null);
          frequencyWarmed++;
        } catch {}
      }
    } catch {}
  }

  refreshCardDatabase().catch(() => {});
  res.json({ tracked: results.length, results, portfolioSnapshots, portfolioWarmed, portfolioCardsTracked: portfolioQueries.length, frequencyWarmed });
});

// GET /api/arbitrage — cross-source price comparison for a card
app.get("/api/arbitrage", apiAuthMiddleware, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;

  const isDemo = req.query.demo === "true";

  try {
    const sources = ["ebay", "magi", "yahoo", "snkrdunk"];
    const pricesBySource = {};

    for (const source of sources) {
      try {
        let data;
        if (isDemo) {
          const full = getDemoSearchResult(q);
          const items = [];
          for (const arr of Object.values(full.activeByCountry || {})) items.push(...arr);
          const filtered = items.filter(i => {
            const url = i.itemWebUrl || "";
            const match = { ebay: "ebay", magi: "magi", yahoo: "yahoo", snkrdunk: "snkrdunk" };
            return url.includes(match[source]);
          });
          data = { activeByCountry: { US: filtered }, source };
        } else {
          const config = buildConfig({ ...req.query, source });
          config._cachePrefix = cachePrefix(req);
          if (source === "snkrdunk") {
            data = await searchSnkrdunk(q, config);
          } else if (source === "magi") {
            data = await searchMagi(q, config);
          } else if (source === "yahoo") {
            data = await searchYahooAuctions(q, config);
          } else {
            const ebayQuery = buildEbaySearchQuery(q, config);
            const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
            data = { activeByCountry: activeRes.itemsByCountry || {}, source: "ebay" };
          }
        }

        let items = [];
        for (const arr of Object.values(data.activeByCountry || {})) items.push(...arr);
        if (source === "yahoo" && !isDemo) items = filterRelevantResults(items, data.ebaySearchQuery || q).filtered;
        if (items.length) {
          const prices = items.map(i => i.totalCost || i.price).filter(Boolean).sort((a, b) => a - b);
          pricesBySource[source] = {
            lowest: prices[0],
            highest: prices[prices.length - 1],
            count: prices.length,
            currency: items[0].priceCurrency || "USD",
            priceJPY: items[0].priceJPY || null,
          };
        }
      } catch {}
    }

    const sourceNames = Object.keys(pricesBySource);
    let arbitrage = null;
    if (sourceNames.length >= 2) {
      const sorted = sourceNames.sort((a, b) => pricesBySource[a].lowest - pricesBySource[b].lowest);
      const cheapest = sorted[0];
      const most = sorted[sorted.length - 1];
      const spread = Math.round((pricesBySource[most].lowest - pricesBySource[cheapest].lowest) * 100) / 100;
      const spreadPct = Math.round((spread / pricesBySource[most].lowest) * 100);
      if (spread > 0) {
        arbitrage = {
          cheapest: { source: cheapest, price: pricesBySource[cheapest].lowest },
          mostExpensive: { source: most, price: pricesBySource[most].lowest },
          spread,
          spreadPct,
          summary: `${spread > 0 ? "$" + spread : "No"} cheaper on ${cheapest} vs ${most} (${spreadPct}% spread)`,
        };
      }
    }

    res.json({ query: q, sources: pricesBySource, arbitrage });
  } catch (e) {
    logError("arbitrage", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// ============ Admin — API Key Management ============

const admin = express.Router();
admin.use(ownerOnly);

// GET /admin/keys — list all developer keys
admin.get("/keys", async (req, res) => {
  try {
    const keys = await listApiKeys();
    res.json({ keys, count: keys.length });
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /admin/keys — create a new developer key
admin.post("/keys", async (req, res) => {
  const { label, rateLimit: rl } = req.body;
  if (!label) return res.status(400).json({ error: "Missing label" });
  try {
    const result = await createApiKey({ label, rateLimit: rl });
    res.status(201).json(result);
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// GET /admin/keys/:id — get a single key
admin.get("/keys/:id", async (req, res) => {
  try {
    const key = await getApiKey(req.params.id);
    if (!key) return res.status(404).json({ error: "Key not found" });
    res.json(key);
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// PATCH /admin/keys/:id — update label, rateLimit, active
admin.patch("/keys/:id", async (req, res) => {
  try {
    const updated = await updateApiKey(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Key not found" });
    res.json(updated);
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// DELETE /admin/keys/:id — delete a key
admin.delete("/keys/:id", async (req, res) => {
  try {
    const deleted = await deleteApiKey(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Key not found" });
    res.json({ ok: true, id: req.params.id });
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /admin/keys/:id/rotate — rotate a developer key
admin.post("/keys/:id/rotate", async (req, res) => {
  try {
    const result = await rotateApiKey(req.params.id);
    if (!result) return res.status(404).json({ error: "Key not found" });
    res.json(result);
  } catch (e) {
    logError("admin", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.use("/admin", admin);

// POST /api/keys/rotate — rotate the owner API key
app.post("/api/keys/rotate", async (req, res) => {
  const token = getRequestToken(req);
  const ownerKey = process.env.CASECOMP_API_KEY;
  if (!token || token !== ownerKey) {
    return res.status(401).json({ error: "Only the owner key can rotate keys" });
  }

  try {
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    const projectId = process.env.GCLOUD_PROJECT || "casecomp-495718";

    const newKey = `CC_LIVE_${crypto.randomBytes(24).toString("base64url")}`;

    await client.addSecretVersion({
      parent: `projects/${projectId}/secrets/CASECOMP_API_KEY`,
      payload: { data: Buffer.from(newKey) },
    });

    process.env.CASECOMP_API_KEY = newKey;

    res.json({
      ok: true,
      key: newKey,
      note: "New key is active immediately. Old key is invalid. Store this key — it won't be shown again.",
    });
  } catch (e) {
    logError("keys", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, _next) => {
  logError("unhandled", err.message, req.originalUrl, req.requestId);
  res.status(500).json({ error: safeErrorMessage(err), requestId: req.requestId });
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Casecomp API listening on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/docs`);
  if (clientId && clientSecret) {
    try {
      await getToken();
      console.log("eBay OAuth token warmed");
    } catch (e) {
      console.warn(`eBay token warmup failed: ${e.message}`);
    }
  }
  initCardDatabase().catch(() => {});
});
