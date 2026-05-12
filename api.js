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
import { gradeImage } from "./lib/grading/grading.js";
import { parseListingLanguagesFromInput, filterByCondition, detectCondition, flagPriceOutliers, filterRelevantResults } from "./lib/search/filters.js";
import { buildEbaySearchQuery } from "./lib/search/listingQuery.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./lib/search/ebayCategories.js";
import { saveGradeLog, getGradeLogs, saveDrop, getDrops, getDrop, saveWebhook, getWebhooks, deleteWebhook, getFirestoreStatus, saveAlert, getActiveAlerts, updateAlert, getAlertsByEmail, saveErrorLog, getErrorLogs, clearErrorLogs } from "./lib/data/firestore.js";
import { getDemoSearchResult, listDemoCards, findDemoByNumber } from "./lib/data/demo.js";
import { createApiKey, listApiKeys, getApiKey, updateApiKey, deleteApiKey, rotateApiKey, validateApiKey } from "./lib/data/api-keys.js";
import { recordSoldPrices, getPriceHistory } from "./lib/data/price-history.js";
import { seedFromTCGPlayer } from "./lib/sources/tcgplayer.js";
import { getOrCreateCard, findCardByQuery, parseCardIdentity, resolveCardIdToQuery, SET_NAME_MAP } from "./lib/data/card-identity.js";
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

function cachePrefix(req) {
  if (isOwnerKey(req)) return "";
  const token = getRequestToken(req);
  return token.slice(0, 16) + "_";
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

const isLocal = !process.env.K_SERVICE;
app.use("/api", (req, res, next) => {
  if (isLocal || req.path === "/health") return next();
  if (req.query.demo === "true") return demoLimiter(req, res, next);
  if (isSandboxKey(req)) return sandboxLimiter(req, res, next);
  return apiLimiter(req, res, next);
});
if (!isLocal) app.use("/v1", apiLimiter);

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
      return { ...row, grade: { error: e.message } };
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
      const soldTimeout = (p) => Promise.race([p, new Promise(r => setTimeout(() => r({ items: [], source: "timeout" }), 30000))]);
      const [activeRes, soldRes, psaSignal] = await Promise.all([
        searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 }),
        soldTimeout(searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false })),
        getPsaGradingSignal(q, { _cachePrefix: cp }),
      ]);
      result = {
        query: q,
        source: "ebay",
        listingFormat: config.listingFormat,
        activeByCountry: activeRes.itemsByCountry || {},
        sold: soldRes.items || [],
        soldSource: soldRes.source,
        psaSignal,
        counts: {
          activeTotal: Object.values(activeRes.itemsByCountry || {}).reduce((n, arr) => n + arr.length, 0),
          sold: (soldRes.items || []).length,
        },
      };
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
app.get("/api/psa", authMiddleware, (req, res, next) => { req._errorType = "psa"; next(); }, async (req, res) => {
  const { q } = req.query;
  if (!validateQuery(q, res)) return;
  try {
    const signal = await getPsaGradingSignal(q);
    res.json({ query: q, signal });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

// POST /api/grade
app.post("/api/grade", authMiddleware, (req, res, next) => { req._errorType = "grade"; next(); }, async (req, res) => {
  const { imageUrl, extraImages, provider, model, cardName, source, listingId, listingPrice, condition } = req.body;
  if (!imageUrl) return res.status(400).json({ error: "Missing required field: imageUrl" });
  try {
    const config = {
      aiGrading: {
        enabled: true,
        mode: "llm",
        llm: { provider: provider || "claude", model: model || "claude-opus-4-7", maxTokens: 500 },
        cacheGrades: true,
      },
    };
    const extras = (extraImages || []).map(u => ({ imageUrl: u }));
    const grade = await gradeImage(imageUrl, config, extras);

    if (grade && !grade.error) {
      await storeGradeLog({
        ts: new Date().toISOString(),
        cardName: cardName || "unknown",
        source: source || "api",
        listingId: listingId || null,
        imageUrl,
        extraImages: extraImages || [],
        provider: config.aiGrading.llm.provider,
        model: config.aiGrading.llm.model,
        grade,
        listingPrice: listingPrice || null,
        condition: condition || null,
      });
    }

    res.json({ grade, stored: !!(grade && !grade.error) });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
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
    res.status(500).json({ error: e.message });
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

// GET /api/health
app.get("/api/health", async (req, res) => {
  const firestoreStatus = await getFirestoreStatus();
  let ebayUsage = null;
  try { ebayUsage = await getEbayUsageToday(); } catch {}
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    redis: { connected: false, status: "not configured" },
    firestore: firestoreStatus,
    ebay: { configured: !!(clientId && clientSecret), usageToday: ebayUsage, dailyCap: DAILY_CAP },
  });
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
  const devKey = await validateApiKey(token);
  if (devKey) {
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
    return res.json({ query: q, days, history, stats, _demo: true });
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

    res.json({ query: q, days, history, stats, tcgplayer: tcgData });
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

    for (const alert of alerts) {
      try {
        const now = new Date().toISOString();
        await updateAlert(alert.id, { lastChecked: now });

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
              triggered.push({
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
              });
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
            triggered.push({
              alertId: alert.id,
              type: "price",
              email: alert.email,
              query: alert.query,
              currentPrice: lowestPrice,
              targetPrice: alert.targetPrice,
            });
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

  const cards = req.body?.cards || [...new Set([...defaultCards, ...alertCards])];
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
          const soldRes = await Promise.race([
            searchSold({ query: ebayQuery, relevanceQuery: card, languages: [], config: {}, refresh: false, noEbay: false, getToken, on401, soldBrowser: false }),
            new Promise(r => setTimeout(() => r({ items: [], source: "timeout" }), 30000)),
          ]);
          ebaySold = soldRes.items || [];
          if (ebaySold.length) {
            await recordSoldPrices(card, ebaySold, "ebay");
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
      results.push({ card, error: e.message, lastTracked: new Date().toISOString() });
    }
  }
  res.json({ tracked: results.length, results });
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
});
