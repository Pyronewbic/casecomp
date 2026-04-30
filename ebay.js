import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
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
  filterToLikelyTcgCards,
} from "./filters.js";
import { EBAY_CATEGORY_TCG_SINGLE_CARDS_US } from "./ebayCategories.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USAGE_FILE = "ebay-usage.json";
const ACTIVE_CACHE = "ebay-active-cache.json";
const SOLD_CACHE = "ebay-sold-cache.json";
const ACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const SOLD_TTL_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 5000;

const API_BASE = (process.env.EBAY_API_BASE || "https://api.ebay.com").replace(
  /\/$/,
  "",
);
const TOKEN_URL = `${API_BASE}/identity/v1/oauth2/token`;
const BROWSE_SEARCH = `${API_BASE}/buy/browse/v1/item_summary/search`;
/** Use underscores; hyphenated `marketplace-insights` returns 404. */
const INSIGHTS_SEARCH = `${API_BASE}/buy/marketplace_insights/v1_beta/item_sales/search`;

/** Default: Browse / Buy APIs only. Insights scope is restricted; most keysets reject it → invalid_scope. */
const SCOPE_BROWSE_ONLY = "https://api.ebay.com/oauth/api_scope";
const SCOPE_INSIGHTS =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

function oauthScopeString() {
  const custom = process.env.EBAY_OAUTH_SCOPE?.trim();
  if (custom) return custom;
  if (process.env.EBAY_TRY_INSIGHTS_SCOPE === "1") {
    return `${SCOPE_BROWSE_ONLY} ${SCOPE_INSIGHTS}`;
  }
  return SCOPE_BROWSE_ONLY;
}

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
  const primary = oauthScopeString();
  try {
    res = await postToken(primary);
  } catch (e) {
    const err = e.response?.data?.error;
    const msg = e.response?.data?.error_description || e.message || "";
    const scopeRejected =
      err === "invalid_scope" || /invalid.?scope/i.test(String(msg));
    if (scopeRejected && primary !== SCOPE_BROWSE_ONLY) {
      res = await postToken(SCOPE_BROWSE_ONLY);
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

/** When Browse is called with no filter, keep only listings that offer Buy It Now. */
function itemHasFixedPriceOption(item) {
  const bo = item?.buyingOptions;
  if (bo == null) return true;
  if (Array.isArray(bo)) {
    return bo.some((x) => {
      const u = String(x).toUpperCase();
      return u === "FIXED_PRICE" || u.includes("FIXED");
    });
  }
  return true;
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
  const lids = item.leafCategoryIds;
  return {
    itemId: item.itemId,
    title: item.title,
    itemWebUrl: item.itemWebUrl,
    leafCategoryIds: Array.isArray(lids) ? lids : [],
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

const SCRAPE_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function scrapeHtmlHeaders(extra = {}) {
  return {
    "User-Agent": SCRAPE_BROWSER_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    ...extra,
  };
}

function tcgBrowseCategoryIdsString(config) {
  if (config?.tcgListingFocus === false) return "";
  return (
    config.tcgBrowseCategoryIds ||
    process.env.EBAY_BROWSE_CATEGORY_IDS ||
    EBAY_CATEGORY_TCG_SINGLE_CARDS_US
  )
    .trim()
    .replace(/\s+/g, "");
}

/** First numeric category for sold search `_sacat` (usually CCG singles). */
function tcgSoldSacat(config) {
  const raw = tcgBrowseCategoryIdsString(config);
  const first = raw.split(",")[0]?.trim() || "";
  return /^\d+$/.test(first) ? first : "";
}

/** Several URL shapes; eBay is picky about query params and bot detection. */
function soldSearchUrlVariants(query, sacat) {
  const enc = encodeURIComponent(query);
  const cat = sacat ? `&_sacat=${encodeURIComponent(sacat)}` : "";
  return [
    `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=10&_dmd=2${cat}`,
    `https://www.ebay.com/sch/i.html?_nkw=${enc}&_sacat=0&LH_Sold=1&LH_Complete=1&rt=nc&_sop=10`,
    `https://www.ebay.com/sch/i.html?_nkw=${enc}&LH_Sold=1&LH_Complete=1&_sop=10${cat}`,
  ];
}

/**
 * Plain axios does not merge Set-Cookie across redirects into follow-up requests.
 * A jar keeps the session eBay expects before /sch/i.html.
 */
async function createSoldScrapeClient() {
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 35_000,
      maxRedirects: 5,
    }),
  );
  await client.get("https://www.ebay.com/", {
    headers: scrapeHtmlHeaders({
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    }),
    validateStatus: (s) => s >= 200 && s < 500,
  });
  return client;
}

function sanitizeScrapedListingTitle(title) {
  if (!title || typeof title !== "string") return title;
  return title
    .replace(/\s*Opens in a new window or tab\.?/gi, "")
    .replace(/\s*Opens in a new window or\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSoldTilesFromHtml(html) {
  const $ = cheerio.load(html);
  const items = [];

  function pushRow({ title, link, priceText, ended, img }) {
    if (!title || /shop on ebay/i.test(title)) return;
    const cleanTitle = sanitizeScrapedListingTitle(title);
    if (!cleanTitle) return;
    const m = (priceText || "").replace(/,/g, "").match(/[\d.]+/);
    const price = m ? parseFloat(m[0]) : null;
    items.push({
      title: cleanTitle,
      itemWebUrl: (link || "").split("?")[0] || link || "",
      price,
      currency: "USD",
      endedDate: (ended || "").trim(),
      imageUrl: img || null,
      raw: { priceText },
    });
  }

  $(".s-item").each((i, el) => {
    if (i === 0) return;
    const $el = $(el);
    const title = $el.find(".s-item__title").text().trim();
    const link = $el.find("a.s-item__link").attr("href") || "";
    const priceText = $el.find(".s-item__price").first().text().trim();
    const ended = $el.find(".s-item__ended-date, .POSITIVE").text().trim();
    const img =
      $el.find(".s-item__image-img").attr("src") ||
      $el.find("img").attr("src") ||
      null;
    pushRow({ title, link, priceText, ended, img });
  });

  if (!items.length) {
    $(".s-card").each((_, el) => {
      const $el = $(el);
      const link =
        $el.find("a[href*='itm']").first().attr("href") ||
        $el.find("a[href*='ebay.com']").first().attr("href") ||
        "";
      const title =
        $el.find(".s-card__title, .s-item__title, [role='heading']").first()
          .text() ||
        "";
      const priceText = $el
        .find(".s-card__price, .s-item__price, [class*='price']")
        .first()
        .text();
      const ended = $el.find(".s-item__ended-date, .POSITIVE").text().trim();
      const img = $el.find("img").first().attr("src") || null;
      pushRow({ title, link, priceText, ended, img });
    });
  }

  return items;
}

/** eBay SRP keeps hydrating after load; retry if content() races with navigation. */
async function playwrightPageHtml(page) {
  const attempts = 6;
  for (let i = 0; i < attempts; i++) {
    try {
      return await page.content();
    } catch (e) {
      const msg = e.message || String(e);
      const retry =
        /navigating|changing the content|Target page.*closed/i.test(msg);
      if (retry && i < attempts - 1) {
        await sleep(400 + i * 200);
        continue;
      }
      throw e;
    }
  }
}

/**
 * Real Chromium session for /sch/i.html when axios gets 4xx/5xx or bot HTML.
 * Requires: npm install playwright && npx playwright install chromium
 */
async function searchSoldPlaywright(
  query,
  { delayMs = 1000, soldSacat } = {},
) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.warn(
      "[scrape] Playwright is not installed (npm install playwright).",
    );
    return [];
  }

  await sleep(delayMs);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    console.warn(
      `[scrape] Playwright could not launch Chromium (${e.message || e}). Run: npx playwright install chromium`,
    );
    return [];
  }

  try {
    const context = await browser.newContext({
      userAgent: SCRAPE_BROWSER_UA,
      locale: "en-US",
      viewport: { width: 1365, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("https://www.ebay.com/", {
      waitUntil: "load",
      timeout: 35_000,
    });
    await sleep(600);

    const urls = soldSearchUrlVariants(query, soldSacat);
    let html = "";
    let lastStatus = 0;
    for (const url of urls) {
      try {
        const resp = await page.goto(url, {
          waitUntil: "load",
          timeout: 45_000,
        });
        lastStatus = resp?.status() ?? 0;
        await page
          .waitForSelector(".srp-river, .srp-results .s-item, .s-item", {
            timeout: 22_000,
          })
          .catch(() => {});
        await sleep(600);
        const body = await playwrightPageHtml(page);
        if (
          lastStatus < 400 &&
          body.length > 8000 &&
          /s-item|s-card|srp-river|srp-results/i.test(body)
        ) {
          html = body;
          break;
        }
      } catch {
        /* try next URL variant */
      }
    }

    if (!html) {
      console.warn(
        `[scrape] Playwright sold search HTTP ${lastStatus} or empty HTML for "${query.slice(0, 60)}…"`,
      );
      return [];
    }

    if (!/s-item|s-card|srp-river|srp-results/i.test(html)) {
      console.warn(
        `[scrape] Playwright sold page had no listing markers — possible bot/captcha.`,
      );
    }

    return parseSoldTilesFromHtml(html);
  } catch (e) {
    console.warn(`[scrape] Playwright sold error: ${e.message || e}`);
    return [];
  } finally {
    await browser?.close();
  }
}

async function fetchSoldHtmlFallback(
  query,
  relQ,
  { delayMs, soldBrowser, soldSacat },
) {
  const strategies = soldBrowser
    ? [searchSoldPlaywright, searchSoldScrape]
    : [searchSoldScrape];
  const scrapeOpts = { delayMs, soldSacat };

  for (let i = 0; i < strategies.length; i++) {
    const fn = strategies[i];
    if (i === 1 && strategies[0] === searchSoldPlaywright) {
      console.warn(
        "[scrape] Playwright returned no sold rows (or parse empty); trying cookie-jar HTTP scrape (often 503 from eBay).",
      );
    }
    let items = await fn(query, scrapeOpts);
    if (
      items.length === 0 &&
      relQ.trim() !== query.trim()
    ) {
      items = await fn(relQ.trim(), scrapeOpts);
    }
    const tag = fn === searchSoldPlaywright ? "playwright" : "scrape";
    if (items.length) {
      if (tag === "playwright") {
        console.log(`[scrape] sold listings via Playwright (${items.length} raw rows)`);
      }
      return { items, tag };
    }
  }

  console.warn(
    "[scrape] No sold rows from Playwright or HTTP scrape — if eBay.com also shows none, widen keywords (try card name without \"raw\") or check Sold filters on the site.",
  );
  return { items: [], tag: "scrape" };
}

export async function searchSoldScrape(
  query,
  { delayMs = 1000, soldSacat } = {},
) {
  await sleep(delayMs);
  let client = null;
  try {
    client = await createSoldScrapeClient();
  } catch {
    /* fallback below */
  }
  await sleep(400);

  const searchHeaders = scrapeHtmlHeaders({
    "Cache-Control": "max-age=0",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    Referer: "https://www.ebay.com/",
  });

  let html = "";
  let lastStatus = 0;
  const urls = soldSearchUrlVariants(query, soldSacat);
  for (const url of urls) {
    try {
      const res = client
        ? await client.get(url, {
            headers: searchHeaders,
            validateStatus: () => true,
          })
        : await axios.get(url, {
            headers: searchHeaders,
            timeout: 35_000,
            maxRedirects: 5,
            validateStatus: () => true,
          });
      lastStatus = res.status;
      const raw = typeof res.data === "string" ? res.data : "";
      if (res.status < 400 && raw.length > 8000) {
        html = raw;
        break;
      }
    } catch (e) {
      lastStatus = e.response?.status ?? 0;
    }
  }

  if (!html) {
    console.warn(
      `[scrape] sold search HTTP ${lastStatus} for "${query.slice(0, 60)}…" — eBay may require a real browser session. Try: open ${urls[0]} manually, or request Marketplace Insights API access for sold data.`,
    );
    return [];
  }

  if (!/s-item|s-card|srp-river|srp-results/i.test(html)) {
    console.warn(
      `[scrape] sold HTML had no listing markers — possible bot/captcha page.`,
    );
  }

  return parseSoldTilesFromHtml(html);
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
            deliveryFilterRelaxed: false,
            unrestrictedBrowse: false,
          },
        };
  }

  const limit = Math.max(20, config.resultsPerCard * 4);
  const filterStrict = `buyingOptions:{FIXED_PRICE},deliveryCountry:${country}`;
  const filterBinOnly = "buyingOptions:{FIXED_PRICE}";

  async function browseSearch(searchQ, filterStr) {
    const token = await getToken();
    const params = {
      q: searchQ,
      sort: "price",
      limit,
      fieldgroups: "EXTENDED",
    };
    const catIds = tcgBrowseCategoryIdsString(config);
    if (catIds) params.category_ids = catIds;
    if (filterStr != null && filterStr !== "") {
      params.filter = filterStr;
    }
    return ebayRequest(
      {
        method: "GET",
        url: BROWSE_SEARCH,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=${country}`,
        },
        params,
        timeout: 30_000,
      },
      getToken,
      on401,
    );
  }

  async function browseChain(searchQ) {
    let deliveryFilterRelaxed = false;
    let unrestrictedBrowse = false;

    let res = await browseSearch(searchQ, filterStrict);
    let summaries = res.data?.itemSummaries || [];
    if (summaries.length === 0) {
      res = await browseSearch(searchQ, filterBinOnly);
      summaries = res.data?.itemSummaries || [];
      deliveryFilterRelaxed = true;
    }
    if (summaries.length === 0) {
      res = await browseSearch(searchQ, undefined);
      summaries = res.data?.itemSummaries || [];
      deliveryFilterRelaxed = true;
      unrestrictedBrowse = true;
      summaries = summaries.filter(itemHasFixedPriceOption);
    }
    return { summaries, deliveryFilterRelaxed, unrestrictedBrowse };
  }

  function finalizeFromSummaries(summariesIn, browseMeta) {
    const normalizedIn = summariesIn.map(normalizeBrowseItem);
    const afterLangIn = filterByLanguage(
      normalizedIn.map((n) => ({ title: n.title, ...n })),
      lang,
    );
    const langCountIn = afterLangIn.length;
    const { filtered: relFiltered, stats: relStats } = filterRelevantResults(
      afterLangIn,
      relQ,
    );
    const relCountIn = relFiltered.length;
    const afterFmt = filterByListingFormat(relFiltered, config);
    const fmtCountIn = afterFmt.length;
    const afterTcg =
      config.tcgListingFocus !== false
        ? filterToLikelyTcgCards(afterFmt)
        : afterFmt;
    const tcgCountIn = afterTcg.length;
    const sortedIn = [...afterTcg].sort(
      (a, b) => (a.totalCost ?? 0) - (b.totalCost ?? 0),
    );
    const topIn = sortedIn.slice(0, config.resultsPerCard);
    return {
      items: topIn,
      pipeline: {
        fetched: normalizedIn.length,
        afterLanguage: langCountIn,
        afterRelevance: relCountIn,
        afterListingFormat: fmtCountIn,
        afterTcgFocus: tcgCountIn,
        deliveryFilterRelaxed: browseMeta.deliveryFilterRelaxed,
        unrestrictedBrowse: browseMeta.unrestrictedBrowse,
        cardOnlyBrowseFallback: browseMeta.cardOnlyBrowseFallback ?? false,
        relevanceStats: relStats,
      },
      _normalizedLen: normalizedIn.length,
    };
  }

  let { summaries, deliveryFilterRelaxed, unrestrictedBrowse } =
    await browseChain(query);

  if (
    summaries.length === 0 &&
    relevanceQuery &&
    relevanceQuery.trim() !== query.trim()
  ) {
    console.warn(
      `[browse] No itemSummaries for "${query.slice(0, 80)}…"; retrying Browse with card-only "${relevanceQuery}".`,
    );
    const again = await browseChain(relevanceQuery.trim());
    if (again.summaries.length > 0) {
      summaries = again.summaries;
      deliveryFilterRelaxed =
        deliveryFilterRelaxed || again.deliveryFilterRelaxed;
      unrestrictedBrowse = unrestrictedBrowse || again.unrestrictedBrowse;
    }
  }

  if (summaries.length === 0) {
    console.warn(
      `[browse] No itemSummaries for q="${query.slice(0, 72)}" country=${country} — try a shorter card name, confirm the keyset has Production Buy Browse API access, or search on ebay.com with the same keywords.`,
    );
  }

  let payload = finalizeFromSummaries(summaries, {
    deliveryFilterRelaxed,
    unrestrictedBrowse,
    cardOnlyBrowseFallback: false,
  });

  if (
    payload.items.length === 0 &&
    relevanceQuery &&
    relevanceQuery.trim() !== query.trim() &&
    summaries.length > 0
  ) {
    console.warn(
      `[browse] No rows after filters for full-query results; retrying Browse with card-only "${relevanceQuery}".`,
    );
    const wider = await browseChain(relevanceQuery.trim());
    if (wider.summaries.length > 0) {
      const payload2 = finalizeFromSummaries(wider.summaries, {
        deliveryFilterRelaxed: wider.deliveryFilterRelaxed,
        unrestrictedBrowse: wider.unrestrictedBrowse,
        cardOnlyBrowseFallback: true,
      });
      if (payload2.items.length > 0) {
        payload = payload2;
      }
    }
  }

  const { unrestrictedBrowse: ub, deliveryFilterRelaxed: dfr } =
    payload.pipeline;
  if (ub && payload.pipeline.fetched > 0) {
    console.warn(
      `[browse] Used unfiltered Browse + client-side BIN filter — confirm price type and shipping to ${country}.`,
    );
  } else if (dfr && payload.pipeline.fetched > 0) {
    console.warn(
      `[browse] Relaxed Browse filters (no deliveryCountry and/or no server BIN filter) — verify shipping and BIN on eBay.`,
    );
  }

  const disk = (await readJsonCache(ACTIVE_CACHE, refresh ? 0 : ACTIVE_TTL_MS)) || {
    entries: {},
  };
  disk.entries = disk.entries || {};
  disk.entries[key] = payload;
  disk._expiresAt = Date.now() + ACTIVE_TTL_MS;
  await writeJsonCache(ACTIVE_CACHE, disk);

  return payload;
}

function formatInsightsError(e) {
  const d = e.response?.data;
  if (d && Array.isArray(d.errors)) {
    return d.errors
      .map((x) => x.longMessage || x.message || `errorId=${x.errorId}`)
      .join("; ");
  }
  if (d && typeof d === "object") {
    try {
      return JSON.stringify(d).slice(0, 280);
    } catch {
      /* */
    }
  }
  return e.message || String(e);
}

export async function searchSoldInsights(
  query,
  { getToken, on401, limit = 50 },
) {
  const token = await getToken();
  const sort = process.env.EBAY_INSIGHTS_SORT?.trim();
  const params = { q: query, limit };
  if (sort) params.sort = sort;

  const res = await ebayRequest(
    {
      method: "GET",
      url: INSIGHTS_SEARCH,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      params,
      timeout: 30_000,
    },
    getToken,
    on401,
  );
  const raw = res.data;
  const list =
    raw?.itemSales || raw?.item_sales || raw?.itemSummaries || [];
  return list.map(insightsToSold);
}

/**
 * @returns {Promise<{ items: object[], source: string, pipeline: object }>}
 */
export async function searchSold(
  {
    query,
    relevanceQuery,
    lang,
    config,
    refresh,
    noEbay,
    getToken,
    on401,
    soldBrowser = false,
  },
) {
  const relQ = relevanceQuery ?? query;
  const key = `${query}::${lang}::${soldBrowser ? "pw" : "http"}`;
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
  const insightsLimit = Math.max(30, config.soldListingsLimit * 5);

  try {
    items = await searchSoldInsights(query, {
      getToken,
      on401,
      limit: insightsLimit,
    });
    if (
      items.length === 0 &&
      relQ.trim() !== query.trim()
    ) {
      items = await searchSoldInsights(relQ.trim(), {
        getToken,
        on401,
        limit: insightsLimit,
      });
    }
    if (items.length > 0) {
      console.log(`[insights] ${items.length} raw sold rows from API`);
    }
  } catch (e) {
    const st = e.response?.status;
    const insightsUnavailable =
      st === 403 ||
      st === 401 ||
      st === 404 ||
      st === 400 ||
      st === 429 ||
      (typeof st === "number" && st >= 500 && st < 600);
    if (!insightsUnavailable) throw e;
    console.warn(
      `[insights] ${formatInsightsError(e)} (HTTP ${st ?? "?"}) — using HTML fallback`,
    );
    const fb = await fetchSoldHtmlFallback(query, relQ, {
      delayMs: 1000,
      soldBrowser,
      soldSacat: tcgSoldSacat(config),
    });
    items = fb.items;
    source = fb.tag;
  }

  if (items.length === 0 && source === "insights") {
    console.warn(
      `[insights] 0 sold rows from API for this query — using HTML fallback`,
    );
    const fb = await fetchSoldHtmlFallback(query, relQ, {
      delayMs: 1000,
      soldBrowser,
      soldSacat: tcgSoldSacat(config),
    });
    items = fb.items;
    source = fb.tag;
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
  const afterTcg =
    config.tcgListingFocus !== false
      ? filterToLikelyTcgCards(afterFormat)
      : afterFormat;
  const tcgCount = afterTcg.length;

  const sorted = [...afterTcg].sort((a, b) => {
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
    afterTcgFocus: tcgCount,
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
      afterTcgFocus: tcgCount,
      relevanceStats: stats,
    },
  };
}

export async function testEbayAuth(clientId, clientSecret) {
  await getAccessToken(clientId, clientSecret);
  return true;
}

export { DAILY_CAP };
