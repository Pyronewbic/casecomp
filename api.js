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

const PORT = process.env.API_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casecomp API listening on http://localhost:${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/docs`);
});
