import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  readJsonCache,
  writeJsonCache,
  cachePath,
} from "./cache.js";
import {
  filterByLanguage,
  filterRelevantResults,
  filterByListingFormat,
} from "./filters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = "ebay-usage.json";
const ACTIVE_CACHE = "ebay-active-cache.json";
const SOLD_CACHE = "ebay-sold-cache.json";
const ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const SOLD_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 5000;

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_SEARCH =
  "https://api.ebay.com/buy/browse/v1/item_summary/search";
const INSIGHTS_SEARCH =
  "https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search";

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights",
].join(" ");

let tokenCache = { access_token: null, expires_at: 0 };
let lastEbayRequestAt = 0;
const MIN_EBAY_INTERVAL_MS = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleEbay() {
  const now = Date.now();
  const wait = MIN_EBAY_INTERVAL_MS - (now - lastEbayRequestAt);
  if (wait > 0) await sleep(wait);
  lastEbayRequestAt = Date.now();
}

async function with429Backoff(fn, label) {
  const delays = [1000, 2000, 4000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e.response?.status;
      if (status === 429 && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function bumpEbayUsage(count = 1) {
  const p = cachePath(USAGE_FILE);
  const day = new Date().toISOString().slice(0, 10);
  let data = { day, count: 0 };
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw);
    if (j.day === day) data = j;
  } catch {
    /* fresh */
  }
  if (data.day !== day) {
    data = { day, count: 0 };
  }
  data.count += count;
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
  return data.count;
}

export async function getEbayUsageToday() {
  const p = cachePath(USAGE_FILE);
  const day = new Date().toISOString().slice(0, 10);
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw);
    if (j.day === day) return j.count;
  } catch {
    /* */
  }
  return 0;
}

export async function getAccessToken(clientId, clientSecret) {
  const now = Date.now();
  if (tokenCache.access_token && tokenCache.expires_at > now + 60_000) {
    return tokenCache.access_token;
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  async function postToken(scopeStr) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: scopeStr,
    });
    return axios.post(TOKEN_URL, body.toString(), {
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }
  let res;
  try {
    res = await postToken(SCOPES);
  } catch (e) {
    const msg = e.response?.data?.error_description || e.message || "";
    if (/invalid_scope|invalid scope/i.test(String(msg))) {
      res = await postToken("https://api.ebay.com/oauth/api_scope");
    } else {
      throw e;
    }
  }
  const exp = res.data.expires_in
    ? now + res.data.expires_in * 1000
    : now + 7_200_000;
  tokenCache = {
    access_token: res.data.access_token,
    expires_at: exp,
  };
  return tokenCache.access_token;
}

export function invalidateToken() {
  tokenCache = { access_token: null, expires_at: 0 };
}

function normalizeBrowseItem(item) {
  const priceVal = parseFloat(item.price?.value ?? "NaN");
  const currency = item.price?.currency ?? "USD";
  let shippingCost = 0;
  let shippingLabel = "—";
  const opts = item.shippingOptions || [];
  const costs = [];
  for (const o of opts) {
    const v = o.shippingCost?.value;
    if (v != null && v !== "") {
      const n = parseFloat(v);
      if (!Number.isNaN(n)) costs.push(n);
    }
  }
  if (costs.length) {
    shippingCost = Math.min(...costs);
    shippingLabel =
      shippingCost === 0 ? "free" : `$${shippingCost.toFixed(2)}`;
  } else if (opts.some((o) => o.shippingCostType === "FREE")) {
    shippingCost = 0;
    shippingLabel = "free";
  }
  const totalCost =
    (Number.isNaN(priceVal) ? 0 : priceVal) +
    (Number.isNaN(shippingCost) ? 0 : shippingCost);
  const add = (item.additionalImages || []).map((x) => x.imageUrl).filter(Boolean);
  return {
    itemId: item.itemId,
    title: item.title,
    itemWebUrl: item.itemWebUrl,
    price: priceVal,
    priceCurrency: currency,
    shippingCost,
    shippingLabel,
    totalCost,
    location: item.itemLocation?.country || item.itemLocation?.city || "",
    condition: item.condition || item.conditionId || "",
    imageUrl: item.image?.imageUrl || null,
    additionalImages: add,
    raw: item,
  };
}

function insightsToSold(entry) {
  const price =
    parseFloat(
      entry.lastSoldPrice?.value ??
        entry.transactionPrice?.value ??
        entry.price?.value ??
        "NaN",
    );
  const date =
    entry.itemEndDate ||
    entry.soldDate ||
    entry.lastSoldDate ||
    entry.transactionDate ||
    "";
  return {
    title: entry.title || "",
    itemWebUrl: entry.itemWebUrl || entry.itemHref || "",
    price: Number.isNaN(price) ? null : price,
    currency:
      entry.lastSoldPrice?.currency ||
      entry.transactionPrice?.currency ||
      "USD",
    endedDate: date,
    imageUrl: entry.image?.imageUrl || null,
    raw: entry,
  };
}

function scrapeSoldUrl(query) {
  const q = encodeURIComponent(query);
  // Newly listed first ≈ most recently sold for completed listings
  return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=10`;
}

export async function searchSoldScrape(query, { delayMs = 1000 } = {}) {
  await sleep(delayMs);
  const url = scrapeSoldUrl(query);
  const res = await axios.get(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; CardSearchBot/1.0; +https://example.local)",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 30_000,
  });
  const $ = cheerio.load(res.data);
  const items = [];
  $(".s-item").each((i, el) => {
    if (i === 0) return;
    const $el = $(el);
    const title = $el.find(".s-item__title").text().trim();
    if (!title || /shop on ebay/i.test(title)) return;
    const link = $el.find("a.s-item__link").attr("href") || "";
    const priceText = $el.find(".s-item__price").first().text().trim();
    const ended = $el.find(".s-item__ended-date, .POSITIVE").text().trim();
    const m = priceText.replace(/,/g, "").match(/[\d.]+/);
    const price = m ? parseFloat(m[0]) : null;
    const img =
      $el.find(".s-item__image-img").attr("src") ||
      $el.find("img").attr("src") ||
      null;
    items.push({
      title,
      itemWebUrl: link.split("?")[0] || link,
      price,
      currency: "USD",
      endedDate: ended,
      imageUrl: img,
      raw: { priceText },
    });
  });
  return items;
}

async function ebayRequest(config, getToken, on401) {
  await throttleEbay();
  await bumpEbayUsage(1);
  return with429Backoff(async () => {
    try {
      return await axios(config);
    } catch (e) {
      if (e.response?.status === 401 && on401) {
        await on401();
        const next = { ...config };
        next.headers = {
          ...config.headers,
          Authorization: `Bearer ${await getToken()}`,
        };
        return await axios(next);
      }
      throw e;
    }
  }, "ebay");
}

/**
 * @param {object} opts
 * @param {string} opts.query - eBay search string (includes slab/raw hints)
 * @param {string} [opts.relevanceQuery] - base card string for fuzzy match (defaults to query)
 * @param {string} opts.country US|IN
 * @param {string} opts.lang eng|jp|any
 * @param {object} opts.config - app CONFIG
 * @param {boolean} opts.refresh
 * @param {boolean} opts.noEbay
 */
export async function searchActive(
  {
    query,
    relevanceQuery,
    country,
    lang,
    config,
    refresh,
    noEbay,
    getToken,
    on401,
  },
) {
  const relQ = relevanceQuery ?? query;
  const key = `${query}::${country}::${lang}`;
  if (!refresh && !noEbay) {
    const disk = await readJsonCache(ACTIVE_CACHE, ACTIVE_TTL_MS);
    const ent = disk?.entries?.[key];
    if (ent?.items) return ent;
  }
  if (noEbay) {
    const disk = await readJsonCache(ACTIVE_CACHE, ACTIVE_TTL_MS);
    const ent = disk?.entries?.[key];
    return ent?.items
      ? ent
      : {
          items: [],
          pipeline: {
            fetched: 0,
            afterLanguage: 0,
            afterRelevance: 0,
            afterListingFormat: 0,
          },
        };
  }

  const limit = Math.max(20, config.resultsPerCard * 4);
  const filter = `buyingOptions:{FIXED_PRICE},deliveryCountry:${country}`;
  const token = await getToken();
  const res = await ebayRequest(
    {
      method: "GET",
      url: BROWSE_SEARCH,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=${country}`,
      },
      params: {
        q: query,
        filter,
        sort: "price",
        limit,
        fieldgroups: "EXTENDED",
      },
      timeout: 30_000,
    },
    getToken,
    on401,
  );

  const summaries = res.data?.itemSummaries || [];
  const normalized = summaries.map(normalizeBrowseItem);

  let afterLang = filterByLanguage(
    normalized.map((n) => ({ title: n.title, ...n })),
    lang,
  );
  const langCount = afterLang.length;

  const { filtered, stats } = filterRelevantResults(afterLang, relQ);
  const relCount = filtered.length;

  const afterFormat = filterByListingFormat(filtered, config);
  const fmtCount = afterFormat.length;

  const sorted = [...afterFormat].sort(
    (a, b) => (a.totalCost ?? 0) - (b.totalCost ?? 0),
  );
  const top = sorted.slice(0, config.resultsPerCard);

  const payload = {
    items: top,
    pipeline: {
      fetched: normalized.length,
      afterLanguage: langCount,
      afterRelevance: relCount,
      afterListingFormat: fmtCount,
      relevanceStats: stats,
    },
  };

  const disk = (await readJsonCache(ACTIVE_CACHE, refresh ? 0 : ACTIVE_TTL_MS)) || {
    entries: {},
  };
  disk.entries = disk.entries || {};
  disk.entries[key] = payload;
  disk._expiresAt = Date.now() + ACTIVE_TTL_MS;
  await writeJsonCache(ACTIVE_CACHE, disk);

  return payload;
}

export async function searchSoldInsights(
  query,
  { getToken, on401, limit = 50 },
) {
  const token = await getToken();
  const res = await ebayRequest(
    {
      method: "GET",
      url: INSIGHTS_SEARCH,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      params: {
        q: query,
        limit,
        sort: "-itemEndDate",
      },
      timeout: 30_000,
    },
    getToken,
    on401,
  );
  const list = res.data?.itemSales || res.data?.itemSummaries || [];
  return list.map(insightsToSold);
}

/**
 * @returns {Promise<{ items: object[], source: string, pipeline: object }>}
 */
export async function searchSold(
  { query, relevanceQuery, lang, config, refresh, noEbay, getToken, on401 },
) {
  const relQ = relevanceQuery ?? query;
  const key = `${query}::${lang}`;
  if (!refresh && !noEbay) {
    const disk = await readJsonCache(SOLD_CACHE, SOLD_TTL_MS);
    if (disk?.entries?.[key]) {
      return {
        items: disk.entries[key],
        source: disk.sources?.[key] || "cache",
        pipeline: disk.pipelines?.[key] || {},
      };
    }
  }
  if (noEbay) {
    const disk = await readJsonCache(SOLD_CACHE, SOLD_TTL_MS);
    const cached = disk?.entries?.[key];
    return {
      items: cached || [],
      source: cached?.length ? "cache" : "no-ebay",
      pipeline: {
        fetched: cached?.length || 0,
        afterLanguage: cached?.length || 0,
        afterRelevance: cached?.length || 0,
        afterListingFormat: cached?.length || 0,
      },
    };
  }

  let items = [];
  let source = "insights";
  try {
    items = await searchSoldInsights(query, {
      getToken,
      on401,
      limit: Math.max(30, config.soldListingsLimit * 5),
    });
  } catch (e) {
    if (e.response?.status === 403 || e.response?.status === 401) {
      source = "scrape";
      items = await searchSoldScrape(query, { delayMs: 1000 });
    } else {
      throw e;
    }
  }

  const mapped = items.map((i) => ({
    title: i.title,
    itemWebUrl: i.itemWebUrl,
    price: i.price,
    currency: i.currency || "USD",
    endedDate: i.endedDate,
    imageUrl: i.imageUrl,
    raw: i.raw,
  }));

  let afterLang = filterByLanguage(mapped, lang);
  const langCount = afterLang.length;
  const { filtered, stats } = filterRelevantResults(afterLang, relQ);
  const relCount = filtered.length;

  const afterFormat = filterByListingFormat(filtered, config);
  const fmtCount = afterFormat.length;

  const sorted = [...afterFormat].sort((a, b) => {
    const da = Date.parse(a.endedDate) || 0;
    const db = Date.parse(b.endedDate) || 0;
    return db - da;
  });
  const top = sorted.slice(0, config.soldListingsLimit);

  const disk = (await readJsonCache(SOLD_CACHE, refresh ? 0 : SOLD_TTL_MS)) || {
    entries: {},
    sources: {},
    pipelines: {},
  };
  disk.entries[key] = top;
  disk.sources[key] = source;
  disk.pipelines[key] = {
    fetched: mapped.length,
    afterLanguage: langCount,
    afterRelevance: relCount,
    afterListingFormat: fmtCount,
    relevanceStats: stats,
  };
  disk._expiresAt = Date.now() + SOLD_TTL_MS;
  await writeJsonCache(SOLD_CACHE, disk);

  return {
    items: top,
    source,
    pipeline: {
      fetched: mapped.length,
      afterLanguage: langCount,
      afterRelevance: relCount,
      afterListingFormat: fmtCount,
      relevanceStats: stats,
    },
  };
}

export async function testEbayAuth(clientId, clientSecret) {
  await getAccessToken(clientId, clientSecret);
  return true;
}

export { DAILY_CAP };
