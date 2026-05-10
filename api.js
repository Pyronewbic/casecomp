import "dotenv/config";
import crypto from "crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./lib/swagger.js";
import { getAccessToken, invalidateToken, searchActive, searchSold, getEbayUsageToday, DAILY_CAP } from "./lib/ebay.js";
import { searchSnkrdunk } from "./lib/snkrdunk.js";
import { searchMagi } from "./lib/magi.js";
import { searchYahooAuctions } from "./lib/yahooauctions.js";
import { getPsaGradingSignal } from "./lib/psa.js";
import { gradeImage } from "./lib/grading.js";
import { parseListingLanguagesFromInput } from "./lib/filters.js";
import { buildEbaySearchQuery } from "./lib/listingQuery.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./lib/ebayCategories.js";
import { getRedisStatus, sha256 } from "./lib/redis-cache.js";
import { saveGradeLog, getGradeLogs, saveDrop, getDrops, getDrop, saveWebhook, getWebhooks, deleteWebhook, getFirestoreStatus, saveAlert, saveErrorLog, getErrorLogs } from "./lib/firestore.js";
import { getDemoSearchResult, listDemoCards } from "./lib/demo.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set("trust proxy", true);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

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

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const demoLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: "Too many requests, please try again later" },
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (req.query.demo === "true") return demoLimiter(req, res, next);
  return apiLimiter(req, res, next);
});
app.use("/v1", apiLimiter);

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
      const backImg = (row.additionalImages || [])[0];
      const extraImages = backImg ? [backImg] : [];
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
    return res.json(getDemoSearchResult(q, { source: req.query.source, condition: req.query.condition }));
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
    } else {
      const ebayQuery = buildEbaySearchQuery(q, config);
      const cp = cachePrefix(req);
      config._cachePrefix = cp;
      const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
      const soldRes = await searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false });
      const psaSignal = await getPsaGradingSignal(q, { _cachePrefix: cp });
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
      sold = r.sold;
      soldSource = r.soldSource;
    } else {
      const ebayQuery = buildEbaySearchQuery(q, config);
      config._cachePrefix = cachePrefix(req);
      const soldRes = await searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false });
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

// GET /api/health
app.get("/api/health", async (req, res) => {
  const [redisStatus, firestoreStatus] = await Promise.all([getRedisStatus(), getFirestoreStatus()]);
  let ebayUsage = null;
  try { ebayUsage = await getEbayUsageToday(); } catch {}
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    redis: redisStatus,
    firestore: firestoreStatus,
    ebay: { configured: !!(clientId && clientSecret), usageToday: ebayUsage, dailyCap: DAILY_CAP },
  });
});

// ============ V1 API — Drop Intelligence ============

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

function authMiddleware(req, res, next) {
  const key = process.env.CASECOMP_API_KEY;
  if (!key) return next();
  const auth = req.headers.authorization;
  const query = req.query.key;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : query;
  if (!token || token !== key) {
    return res.status(401).json({ error: "Invalid or missing API key" });
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
      active = r.items || r.active || [];
      sold = r.sold || [];
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

// POST /api/alerts — collect price alert signups
app.post("/api/alerts", authMiddleware, async (req, res) => {
  const { email, targetPrice, query } = req.body;
  if (!email || !query) return res.status(400).json({ error: "Missing email or query" });
  try {
    await saveAlert({ email, targetPrice: targetPrice || null, query, createdAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    logError(req._errorType || "api", e.message, req.originalUrl, req.requestId);
    res.status(500).json({ error: safeErrorMessage(e), requestId: req.requestId });
  }
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casecomp API listening on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/docs`);
});
