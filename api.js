import "dotenv/config";
import express from "express";
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
import { getRedisStatus, cacheWritePermanent, cacheReadByPattern, sha256 } from "./lib/redis-cache.js";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;
async function getToken() { return getAccessToken(clientId, clientSecret); }
async function on401() { invalidateToken(); }

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
  const key = `casecomp:grade-log:${Date.now()}:${sha256(record.imageUrl)}`;
  await cacheWritePermanent(key, record);
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

// GET /api/search
app.get("/api/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing required parameter: q" });
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
      const activeRes = await searchActive({ query: ebayQuery, relevanceQuery: q, deliveryCountries: config.deliveryCountries, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401 });
      const soldRes = await searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false });
      const psaSignal = config.listingFormat === "raw" ? await getPsaGradingSignal(q) : null;
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
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sold
app.get("/api/sold", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing required parameter: q" });
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
      const soldRes = await searchSold({ query: ebayQuery, relevanceQuery: q, languages: config.languages, config, refresh: false, noEbay: false, getToken, on401, soldBrowser: false });
      sold = soldRes.items || [];
      soldSource = soldRes.source;
    }

    res.json({ query: q, sold, soldSource, counts: { sold: sold.length } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/psa
app.get("/api/psa", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing required parameter: q" });
  try {
    const signal = await getPsaGradingSignal(q);
    res.json({ query: q, signal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/grade
app.post("/api/grade", async (req, res) => {
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
    res.status(500).json({ error: e.message });
  }
});

// GET /api/grades
app.get("/api/grades", async (req, res) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  try {
    let records = await cacheReadByPattern("casecomp:grade-log:*", limit);

    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      records = records.filter(r => (r.cardName || "").toLowerCase().includes(q));
    }
    if (req.query.source) {
      records = records.filter(r => r.source === req.query.source);
    }

    res.json(records);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/health
app.get("/api/health", async (req, res) => {
  const redisStatus = await getRedisStatus();
  let ebayUsage = null;
  try { ebayUsage = await getEbayUsageToday(); } catch {}
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    redis: redisStatus,
    ebay: { configured: !!(clientId && clientSecret), usageToday: ebayUsage, dailyCap: DAILY_CAP },
  });
});

// ============ V1 API — Drop Intelligence ============

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  const key = process.env.CASECOMP_API_KEY;
  if (!key) return next();
  if (!auth || !auth.startsWith("Bearer ") || auth.slice(7) !== key) {
    return res.status(401).json({ error: "Invalid or missing API key" });
  }
  next();
}

const v1 = express.Router();
v1.use(authMiddleware);

// GET /v1/drops — list recent drop events
v1.get("/drops", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const site = req.query.site;
  const status = req.query.status;
  try {
    let records = await cacheReadByPattern("casecomp:drop:*", limit * 3);
    if (site) records = records.filter(r => (r.site || "").toLowerCase().includes(site.toLowerCase()));
    if (status) records = records.filter(r => r.status === status);
    records = records.slice(0, limit);
    res.json({ drops: records, count: records.length, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /v1/drops/:id — single drop with queue metrics
v1.get("/drops/:id", async (req, res) => {
  try {
    const records = await cacheReadByPattern(`casecomp:drop:*${req.params.id}*`, 1);
    if (!records.length) return res.status(404).json({ error: "Drop not found" });
    res.json(records[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// POST /v1/webhooks — register webhook
const webhooks = [];

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
  webhooks.push(webhook);

  try {
    await cacheWritePermanent(`casecomp:webhook:${webhook.id}`, webhook);
  } catch {}

  res.status(201).json(webhook);
});

// GET /v1/webhooks — list registered webhooks
v1.get("/webhooks", async (req, res) => {
  try {
    const stored = await cacheReadByPattern("casecomp:webhook:*", 50);
    res.json({ webhooks: stored, count: stored.length });
  } catch (e) {
    res.json({ webhooks, count: webhooks.length });
  }
});

// DELETE /v1/webhooks/:id — remove webhook
v1.delete("/webhooks/:id", async (req, res) => {
  const idx = webhooks.findIndex(w => w.id === req.params.id);
  if (idx !== -1) webhooks.splice(idx, 1);
  res.json({ ok: true, id: req.params.id });
});

app.use("/v1", v1);

// Helper: log a drop event (called from extension sync or internal)
app.post("/api/drop-event", async (req, res) => {
  const { site, status, detail, url, tabId } = req.body;
  if (!site || !status) return res.status(400).json({ error: "Missing site or status" });
  const drop = {
    id: `drp_${Date.now().toString(36)}`,
    ts: new Date().toISOString(),
    site, status, detail: detail || "", url: url || "", tabId: tabId || null,
  };
  try {
    await cacheWritePermanent(`casecomp:drop:${drop.id}`, drop);
    // fire webhooks
    for (const wh of webhooks) {
      const eventMap = { detected: "drop.opened", through: "queue.through", joined: "queue.joined", waiting: "queue.advanced", captcha: "captcha.detected", "atc-success": "checkout.cleared", "new-listing": "listing.new" };
      const event = eventMap[status];
      if (event && wh.active && wh.events.includes(event)) {
        fetch(wh.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, drop }) }).catch(() => {});
      }
    }
    res.json(drop);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casecomp API listening on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/docs`);
});
