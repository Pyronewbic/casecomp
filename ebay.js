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
  filterByListedLanguages,
  filterRelevantResults,
  filterByListingFormat,
  filterToLikelyTcgCards,
  enforceListingLanguageFacetMatchLangs,
  listingLanguageFacetFromItem,
  listingLanguagesCacheTag,
  listingConditionFacetFromItem,
  listingGradeLabelFromSellerListing,
} from "./filters.js";
import {
  EBAY_CATEGORY_TCG_SINGLE_CARDS_US,
  EBAY_ITEM_SPECIFIC_LANGUAGE_ASPECT_NAME,
  EBAY_ITEM_SPECIFIC_LANGUAGE_ENGLISH,
  EBAY_ITEM_SPECIFIC_LANGUAGE_JAPANESE,
  EBAY_ITEM_SPECIFIC_LANGUAGE_CHINESE,
} from "./ebayCategories.js";

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

/** Insights is not on the requested grant string → never call Insights (avoids 403 spam). */
export function oauthScopeRequestsMarketplaceInsights() {
  const s = oauthScopeString();
  return /\bbuy\.marketplace\.insights\b/.test(s) || s.includes(SCOPE_INSIGHTS);
}

const INSIGHTS_FORBIDDEN_CACHE = "ebay-insights-forbidden-cache.json";
/** Cooldown after HTTP 403 (restricted API — normal without eBay approval). */
const INSIGHTS_FORBIDDEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let tokenCache = {
  access_token: null,
  expires_at: 0,
  /** Scope string successfully used with `grant_type=client_credentials` last fetch. */
  scope_used: "",
};
let warnedInsightsBypassNoScope = false;
let warnedInsightsBypassNoGrant = false;
let warnedInsightsEnvSkip = false;
let warnedInsights403Cooldown = false;

async function markMarketplaceInsightsForbidden403(summary) {
  await writeJsonCache(INSIGHTS_FORBIDDEN_CACHE, {
    http403: true,
    detail: summary,
    _expiresAt: Date.now() + INSIGHTS_FORBIDDEN_TTL_MS,
  });
}

async function marketplaceInsightsCooldownActive() {
  const j = await readJsonCache(INSIGHTS_FORBIDDEN_CACHE, 0);
  return Boolean(j?.http403);
}

/**
 * Insights API is only reachable with `buy.marketplace.insights` on the token AND eBay-granted access (restricted API).
 */
function tokenGrantIncludedInsightsScope() {
  return oauthScopeRequestsMarketplaceInsights()
    ? /\bbuy\.marketplace\.insights\b/.test(tokenCache.scope_used || "") ||
      (tokenCache.scope_used || "").includes(SCOPE_INSIGHTS)
    : false;
}

function envSkipsInsightsApi() {
  const v = (process.env.EBAY_SKIP_MARKETPLACE_INSIGHTS || "").trim();
  return /^1|true|yes$/i.test(v);
}

function shouldProbeMarketplaceInsightsApi() {
  if (envSkipsInsightsApi()) return false;
  if (!oauthScopeRequestsMarketplaceInsights()) return false;
  return tokenGrantIncludedInsightsScope();
}

function logSoldInsightsBypassOnce(kind, detail = "") {
  if (kind === "no_scope_requested") {
    if (warnedInsightsBypassNoScope) return;
    warnedInsightsBypassNoScope = true;
    console.log(
      "[sold] Skipping Marketplace Insights (default OAuth scopes are Browse-only; Insights is limited-release — needs eBay approval + buy.marketplace.insights). Using HTML sold scrape.",
    );
    return;
  }
  if (kind === "no_insights_grant") {
    if (warnedInsightsBypassNoGrant) return;
    warnedInsightsBypassNoGrant = true;
    console.log(
      "[sold] Skipping Marketplace Insights (eBay returned invalid_scope → token issued Browse-only). Using HTML sold scrape.",
    );
    return;
  }
  if (kind === "env_skip") {
    if (warnedInsightsEnvSkip) return;
    warnedInsightsEnvSkip = true;
    console.log(
      `[sold] Skipping Marketplace Insights (${detail}). Using HTML sold scrape.`,
    );
  }
}
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
  let scopeUsed = primary;
  try {
    res = await postToken(primary);
  } catch (e) {
    const err = e.response?.data?.error;
    const msg = e.response?.data?.error_description || e.message || "";
    const scopeRejected =
      err === "invalid_scope" || /invalid.?scope/i.test(String(msg));
    if (scopeRejected && primary !== SCOPE_BROWSE_ONLY) {
      res = await postToken(SCOPE_BROWSE_ONLY);
      scopeUsed = SCOPE_BROWSE_ONLY;
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
    scope_used: scopeUsed,
  };
  return tokenCache.access_token;
}

export function invalidateToken() {
  tokenCache = {
    access_token: null,
    expires_at: 0,
    scope_used: "",
  };
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
  const conditionTop = item.condition || item.conditionId || "";
  const conditionFacetStr = listingConditionFacetFromItem(item);
  const listingGradeLabel = listingGradeLabelFromSellerListing({
    localizedAspects: item.localizedAspects,
    condition: conditionTop,
    conditionId: item.conditionId,
    title: item.title,
  });
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
    condition: conditionTop,
    conditionFacet: conditionFacetStr,
    listingGradeLabel,
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

const browseShipItemPayloadCache = new Map();
const listingDoesNotShipCache = new Map();

function regionIdOrNameIndicatesCountry(region, iso) {
  const rid = String(region.regionId || "").toUpperCase();
  const rn = String(region.regionName || "").toLowerCase();
  if (iso === "US") {
    return (
      rid === "US" ||
      /\b(united\s+states|u\.s\.(?:a\.?)?|usa)\b/.test(rn)
    );
  }
  if (iso === "IN") {
    return rid === "IN" || /\bindia\b/.test(rn);
  }
  return false;
}

function regionExclusionBlocksBuyer(region, iso) {
  const t = String(region.regionType || "");
  if (t === "COUNTRY") return regionIdOrNameIndicatesCountry(region, iso);
  if (iso !== "IN" || t !== "WORLD_REGION") return false;
  const bundle = `${region.regionId || ""} ${region.regionName || ""}`;
  if (/\bSOUTH_ASIA\b|\bsouth\s+asia\b/i.test(bundle)) return false;
  if (
    /\bMIDDLE.?EAST|NEAR.?EAST|OCEANIA|EUROPE|AFRICA|AMERICAS|SOUTH.?AMERIC|NORTH.?AMERIC|CARIB|CENTRAL_AM|LATIN\b/i.test(
      bundle,
    )
  ) {
    return false;
  }
  return /\bASIA|ASIAN|SOUTHEAST_AS|SOUTH_EAST|SOUTH_AS\b/i.test(bundle);
}

/**
 * BrowseItem `shipToLocations` — sellers often ship worldwide minus exclusions.
 * @returns {{ eligible: boolean|null, detail: string }}
 */
export function inferShipEligibleFromBrowseCore(shipTo, iso2) {
  const iso = String(iso2 || "").toUpperCase();
  if (iso !== "US" && iso !== "IN") {
    return { eligible: null, detail: "iso_unsupported" };
  }
  if (!shipTo || typeof shipTo !== "object") {
    return { eligible: null, detail: "no_ship_block" };
  }
  const inc = shipTo.regionIncluded || [];
  const exc = shipTo.regionExcluded || [];

  for (const r of exc) {
    if (regionExclusionBlocksBuyer(r, iso)) {
      return { eligible: false, detail: "excluded_region" };
    }
  }

  const hasWorldwide = inc.some(
    (r) =>
      String(r.regionType || "").toUpperCase() === "WORLDWIDE" ||
      String(r.regionId || "").toUpperCase() === "WORLDWIDE",
  );
  if (hasWorldwide) {
    return { eligible: true, detail: "worldwide_minus_exclusions" };
  }

  const countryInc = inc.filter(
    (r) => String(r.regionType || "").toUpperCase() === "COUNTRY",
  );
  if (countryInc.length > 0) {
    const ok = countryInc.some((r) => regionIdOrNameIndicatesCountry(r, iso));
    return {
      eligible: ok,
      detail: ok ? "explicit_country_include" : "not_in_ship_list",
    };
  }

  return { eligible: null, detail: "uncertain_bucket_model" };
}

function scrapeDoesNotShipLabelLine(html) {
  if (!html || typeof html !== "string") return null;
  const m = html.match(/(?:doesn'?t|does\s+not)\s+ship\s+to[^<\n.]*/i);
  if (!m) return null;
  let chunk = m[0].trim();
  chunk = chunk.replace(/^(?:doesn'?t|does\s+not)\s+ship\s+to:?\s*/i, "").trim();
  chunk = chunk.split("|")[0] || chunk;
  return chunk
    .split(/[,;]+/)
    .map((raw) =>
      String(raw || "")
        .replace(/\([^)]*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

async function scrapeDoesNotShipList(itemUrl) {
  const url = String(itemUrl || "").split("#")[0];
  if (!/^https:\/\/www\.ebay\.com\/itm\//i.test(url)) return null;
  if (listingDoesNotShipCache.has(url)) return listingDoesNotShipCache.get(url);
  try {
    const res = await axios.get(url, {
      headers: scrapeHtmlHeaders({ Referer: "https://www.ebay.com/" }),
      timeout: 28_000,
      validateStatus: (s) => s >= 200 && s < 500,
      maxRedirects: 5,
    });
    const html = typeof res.data === "string" ? res.data : "";
    const list =
      html.length > 4000 ? scrapeDoesNotShipLabelLine(html) : null;
    listingDoesNotShipCache.set(url, list);
    return list;
  } catch {
    listingDoesNotShipCache.set(url, null);
    return null;
  }
}

function inferEligibleFromDoesNotShipList(list, iso) {
  const u = String(iso || "").toUpperCase();
  if (!list || !list.length) return null;
  if (u === "IN") {
    return list.some((t) => /\bindia\b/.test(String(t))) ? false : true;
  }
  if (u === "US") {
    return list.some((t) =>
      /\b(united\s+states|u\.s\.(?:a\.?)?|\busa\b)\b/.test(String(t)),
    )
      ? false
      : true;
  }
  return null;
}

async function browseGetItemShipPayload(itemIdBrowse, getToken, on401) {
  const id = String(itemIdBrowse || "").trim();
  if (!id) return null;
  if (browseShipItemPayloadCache.has(id)) {
    return browseShipItemPayloadCache.get(id);
  }
  try {
    const encoded = encodeURIComponent(id);
    const token = await getToken();
    const res = await ebayRequest(
      {
        method: "GET",
        url: `${API_BASE}/buy/browse/v1/item/${encoded}`,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        params: {
          fieldgroups:
            process.env.EBAY_ACTIVE_ITEM_FIELDGROUPS?.trim() || "EXTENDED",
        },
        timeout: 28_000,
      },
      getToken,
      on401,
    );
    browseShipItemPayloadCache.set(id, res.data ?? null);
    return res.data ?? null;
  } catch {
    browseShipItemPayloadCache.set(id, null);
    return null;
  }
}

function browseItemIdFromRow(row) {
  const rawId = row?.raw?.itemId;
  if (typeof rawId === "string" && rawId.includes("|")) return rawId;
  if (typeof row?.itemId === "string" && row.itemId.includes("|")) {
    return row.itemId;
  }
  return null;
}

async function enrichRowsShipToDestinations(rows, destinationIsos, opt) {
  const { getToken, on401 } = opt;
  const maxLookups = Math.max(
    1,
    Number(process.env.EBAY_ACTIVE_SHIP_GETITEM_CAP || "") || 64,
  );
  let lookups = 0;
  const isos = destinationIsos.map((x) => String(x).toUpperCase());

  for (const row of rows) {
    row.shippingToBuyer = {};
    const bid = browseItemIdFromRow(row);
    if (!bid) {
      for (const iso of isos) {
        row.shippingToBuyer[iso] = {
          eligible: null,
          detail: "no_browse_item_id",
        };
      }
      continue;
    }
    row.itemId ??= bid;

    if (lookups >= maxLookups) {
      for (const iso of isos) {
        row.shippingToBuyer[iso] = {
          eligible: null,
          detail: "ship_lookup_cap",
        };
      }
      continue;
    }
    lookups += 1;

    const payload = await browseGetItemShipPayload(bid, getToken, on401);

    if (payload) {
      const facet =
        listingConditionFacetFromItem(payload) ??
        listingConditionFacetFromItem(row.raw) ??
        row.conditionFacet;
      const condTop =
        payload.condition ??
        row.raw?.condition ??
        row.condition ??
        "";
      if (facet) row.conditionFacet = facet;
      if (condTop) row.condition = condTop;
    }

    row.listingGradeLabel = listingGradeLabelFromSellerListing({
      localizedAspects:
        payload?.localizedAspects ?? row.raw?.localizedAspects,
      condition: row.condition,
      conditionId: row.raw?.conditionId,
      title: row.title,
    });

    const shipLoc = payload?.shipToLocations;

    let dnsList = null;
    const browseSays = {};
    let needDns = false;
    for (const iso of isos) {
      const verdict = inferShipEligibleFromBrowseCore(shipLoc, iso);
      browseSays[iso] = verdict;
      if (verdict.eligible === null) needDns = true;
    }

    if (needDns && row.itemWebUrl) {
      dnsList = await scrapeDoesNotShipList(row.itemWebUrl);
      if (dnsList?.length) row.doesNotShipToRaw = dnsList.join(", ");
    }

    for (const iso of isos) {
      let v = browseSays[iso];
      if (v.eligible === null) {
        const fromHtml = inferEligibleFromDoesNotShipList(dnsList, iso);
        if (fromHtml !== null) {
          v = {
            eligible: fromHtml,
            detail: "listing_html_does_not_ship",
          };
        }
      }
      row.shippingToBuyer[iso] = {
        eligible:
          typeof v.eligible === "boolean" ? v.eligible : null,
        detail: v.detail || "unset",
      };
    }
  }

  return { lookups };
}

function tcgBrowseCategoryIdsString(config) {
  return (
    config.tcgBrowseCategoryIds ||
    process.env.EBAY_BROWSE_CATEGORY_IDS ||
    EBAY_CATEGORY_TCG_SINGLE_CARDS_US
  )
    .trim()
    .replace(/\s+/g, "");
}

/** First comma-separated Browse category id (required duplicate for `aspect_filter`). */
export function primaryBrowseCategoryId(config) {
  const raw = tcgBrowseCategoryIdsString(config);
  const first = raw.split(",")[0]?.trim() ?? "";
  return /^\d+$/.test(first) ? first : "";
}

/**
 * Item specifics **Language** facet — Browse `aspect_filter`.
 * Multiple codes → **`Language:{English|Japanese}`** (pipe-delimited).
 */
export function buildBrowseLanguageAspectFilterForLangs(langCodes, config) {
  if (!langCodes || langCodes.length === 0) return "";
  const uniq = [...new Set(langCodes)].filter((c) =>
    c === "eng" || c === "jp" || c === "cn",
  );
  if (uniq.length === 0) return "";
  uniq.sort(
    (a, b) =>
      ({ eng: 0, jp: 1, cn: 2 })[a] - ({ eng: 0, jp: 1, cn: 2 })[b],
  );
  const catId = primaryBrowseCategoryId(config);
  if (!catId) return "";
  const pipeJoined = uniq
    .map((c) =>
      c === "eng"
        ? EBAY_ITEM_SPECIFIC_LANGUAGE_ENGLISH
        : c === "jp"
          ? EBAY_ITEM_SPECIFIC_LANGUAGE_JAPANESE
          : EBAY_ITEM_SPECIFIC_LANGUAGE_CHINESE,
    )
    .join("|");
  return `categoryId:${catId},${EBAY_ITEM_SPECIFIC_LANGUAGE_ASPECT_NAME}:{${pipeJoined}}`;
}

/** @deprecated Prefer `buildBrowseLanguageAspectFilterForLangs`; single-code helper. */
export function buildBrowseLanguageAspectFilter(lang, config) {
  if (!lang || lang === "any") return "";
  return buildBrowseLanguageAspectFilterForLangs([lang], config);
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

/** `https://www.ebay.com/itm/123…` → listing id digits for Browse legacy item URIs. */
function extractLegacyItemIdFromItemWebUrl(url) {
  const m = String(url || "").match(/\/itm\/(\d+)/);
  return m ? m[1] : null;
}

function wantListingLanguageFacetDisplay(langCode) {
  if (langCode === "eng") return EBAY_ITEM_SPECIFIC_LANGUAGE_ENGLISH;
  if (langCode === "jp") return EBAY_ITEM_SPECIFIC_LANGUAGE_JAPANESE;
  if (langCode === "cn") return EBAY_ITEM_SPECIFIC_LANGUAGE_CHINESE;
  return "";
}

function titlePassesSoldLanguage(title, langCode) {
  return filterByLanguage([{ title }], langCode).length === 1;
}

function titlePassesSoldLanguages(title, langs) {
  return langs.some((lc) => titlePassesSoldLanguage(title, lc));
}

function soldCompMatchesBrowseListedLangs(itemPayload, title, langs) {
  const fv = listingLanguageFacetFromItem(itemPayload);
  if (fv) {
    const fl = fv.trim().toLowerCase();
    return langs.some(
      (lc) => fl === wantListingLanguageFacetDisplay(lc).toLowerCase(),
    );
  }
  return titlePassesSoldLanguages(title, langs);
}

/**
 * Walk chronological sold comps, call Browse `getItem` until `need` facet-aligned rows OR limits.
 */
async function refineSoldCompsBrowseLanguages(rows, langs, need, opt) {
  const { getToken, on401 } = opt;
  const maxApiCalls = Math.min(
    rows.length,
    typeof opt.maxLookups === "number" ? opt.maxLookups : 60,
  );

  const out = [];
  const seen = new Set();
  let apiCalls = 0;

  for (const row of rows) {
    if (out.length >= need) break;

    const key = `${row.itemWebUrl || ""}::${row.title || ""}`;
    if (seen.has(key)) continue;

    const legacy = extractLegacyItemIdFromItemWebUrl(row.itemWebUrl);
    const title = row.title || "";

    if (!legacy) {
      if (titlePassesSoldLanguages(title, langs)) {
        seen.add(key);
        out.push(row);
      }
      continue;
    }

    if (apiCalls >= maxApiCalls) {
      if (titlePassesSoldLanguages(title, langs)) {
        seen.add(key);
        out.push(row);
      }
      continue;
    }

    apiCalls += 1;
    let payload = null;
    try {
      const encoded = encodeURIComponent(`v1|${legacy}|0`);
      const token = await getToken();
      const res = await ebayRequest(
        {
          method: "GET",
          url: `${API_BASE}/buy/browse/v1/item/${encoded}`,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
          params: { fieldgroups: "PRODUCT" },
          timeout: 25_000,
        },
        getToken,
        on401,
      );
      payload = res.data;
    } catch (e) {
      const st = e.response?.status;
      if (st !== 404) console.warn(`[sold:getItem] ${legacy} (HTTP ${st ?? "?"})`);
    }

    const ok =
      payload != null
        ? soldCompMatchesBrowseListedLangs(payload, title, langs)
        : titlePassesSoldLanguages(title, langs);
    if (!ok) continue;

    seen.add(key);
    out.push(row);
  }

  return { rows: out, apiCalls };
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
 * @param {string[]} [opts.deliveryCountries] Buyer ship-to ISOs (e.g. US, IN). Browse no longer uses `deliveryCountry` filter; we split via getItem + HTML.
 * @param {string} [opts.country] Legacy single destination; use `deliveryCountries` instead.
 * @param {string[]} [opts.languages] Canonical `eng`|`jp`|`cn` (from CLI / CONFIG). Empty = any.
 * @param {string} [opts.lang] Legacy single code; ignored when `languages` is non-empty.
 * @param {object} opts.config - app CONFIG
 * @param {boolean} opts.refresh
 * @param {boolean} opts.noEbay
 */
export async function searchActive(
  {
    query,
    relevanceQuery,
    deliveryCountries: deliveryCountriesOpt,
    country: countryLegacy,
    languages: languagesOpt,
    lang: langLegacy,
    config,
    refresh,
    noEbay,
    getToken,
    on401,
  },
) {
  const langs =
    languagesOpt && languagesOpt.length
      ? [...languagesOpt]
      : langLegacy && langLegacy !== "any"
        ? [langLegacy]
        : [];

  const destinations = (
    deliveryCountriesOpt?.length
      ? deliveryCountriesOpt
      : countryLegacy
        ? [countryLegacy]
        : ["US"]
  )
    .map((x) => String(x).trim().toUpperCase())
    .filter(Boolean);

  const relQ = relevanceQuery ?? query;
  const langKey = listingLanguagesCacheTag(langs);
  const destKey = [...new Set(destinations)].slice().sort().join("+") || "US";
  const browseCtxCountry = (
    process.env.EBAY_BROWSE_CONTEXT_COUNTRY || "US"
  )
    .trim()
    .toUpperCase();

  const key = `${query}::vship::${destKey}::${langKey}`;
  if (!refresh && !noEbay) {
    const disk = await readJsonCache(ACTIVE_CACHE, ACTIVE_TTL_MS);
    const ent = disk?.entries?.[key];
    if (ent?.itemsByCountry) return ent;
  }
  if (noEbay) {
    const disk = await readJsonCache(ACTIVE_CACHE, ACTIVE_TTL_MS);
    const ent = disk?.entries?.[key];
    if (ent?.itemsByCountry) return ent;
    const emptyCountries = {};
    destinations.forEach((c) => {
      emptyCountries[c] = [];
    });
    return {
      itemsByCountry: emptyCountries,
      items: [],
      pipeline: {
        fetched: 0,
        afterLanguage: 0,
        afterRelevance: 0,
        afterListingFormat: 0,
        browseLanguageFacet: false,
        deliveryFilterRelaxed: false,
        unrestrictedBrowse: false,
        browseUsedDeliveryCountryFilter: false,
        shipToGetItemLookups: 0,
      },
    };
  }

  const limit = Math.max(24, config.resultsPerCard * 6);
  const filterBrowsePrimary = "buyingOptions:{FIXED_PRICE}";
  const languageAspectCandidate = buildBrowseLanguageAspectFilterForLangs(
    langs,
    config,
  );

  if (langs.length && !languageAspectCandidate) {
    const label = langs
      .map((l) => wantListingLanguageFacetDisplay(l))
      .filter(Boolean)
      .join(" | ");
    console.warn(
      `[browse] langs [${langs.join(",")}] → Item specifics **Language:** **${label}** via Browse **aspect_filter** only when **category_ids** resolve (defaults to TCG Singles). If category_ids are missing, narrowing uses title signals only.`,
    );
  }

  async function browseSearch(searchQ, filterStr, aspectFilterOpt) {
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
    if (aspectFilterOpt) {
      params.aspect_filter = aspectFilterOpt;
    }
    return ebayRequest(
      {
        method: "GET",
        url: BROWSE_SEARCH,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=${browseCtxCountry}`,
        },
        params,
        timeout: 30_000,
      },
      getToken,
      on401,
    );
  }

  async function browseSearchTryLanguageFacet(searchQ, filterStr) {
    if (!languageAspectCandidate) {
      const res = await browseSearch(searchQ, filterStr, null);
      return { res, facetOnWire: false };
    }
    try {
      const res = await browseSearch(
        searchQ,
        filterStr,
        languageAspectCandidate,
      );
      return { res, facetOnWire: true };
    } catch (e) {
      const status = e.response?.status;
      if (status === 400 || status === 404) {
        console.warn(
          `[browse] Language aspect_filter rejected (HTTP ${status}); falling back to title-based langs [${listingLanguagesCacheTag(langs)}]`,
        );
        const res = await browseSearch(searchQ, filterStr, null);
        return { res, facetOnWire: false };
      }
      throw e;
    }
  }

  async function browseChain(searchQ) {
    let deliveryFilterRelaxed = false;
    let unrestrictedBrowse = false;
    let browseLanguageFacetActive = false;

    let pack = await browseSearchTryLanguageFacet(searchQ, filterBrowsePrimary);
    if (pack.facetOnWire) browseLanguageFacetActive = true;
    let res = pack.res;
    let summaries = res.data?.itemSummaries || [];

    async function rerunLooser(nextFilterStr, markRelaxed, useUnrestrictedBin) {
      pack = await browseSearchTryLanguageFacet(searchQ, nextFilterStr);
      if (pack.facetOnWire) browseLanguageFacetActive = true;
      res = pack.res;
      summaries = res.data?.itemSummaries || [];
      if (markRelaxed) deliveryFilterRelaxed = true;
      if (useUnrestrictedBin) {
        unrestrictedBrowse = true;
        summaries = summaries.filter(itemHasFixedPriceOption);
      }
    }

    if (summaries.length === 0) {
      await rerunLooser(undefined, true, true);
    }

    return {
      summaries,
      deliveryFilterRelaxed,
      unrestrictedBrowse,
      browseLanguageFacetActive,
    };
  }

  function finalizeFromSummaries(summariesIn, browseMeta, poolFloorArg) {
    const normalizedIn = summariesIn.map(normalizeBrowseItem);
    let working = [...normalizedIn];
    if (!browseMeta.browseLanguageFacetActive) {
      working = filterByListedLanguages(normalizedIn, langs);
    }
    const langCountIn = working.length;
    const { filtered: relFiltered, stats: relStats } = filterRelevantResults(
      working,
      relQ,
    );
    const relCountIn = relFiltered.length;
    const afterFmt = filterByListingFormat(relFiltered, config);
    const fmtCountIn = afterFmt.length;
    const afterTcg = filterToLikelyTcgCards(afterFmt);
    const afterFacetCoerced = browseMeta.browseLanguageFacetActive
      ? enforceListingLanguageFacetMatchLangs(afterTcg, langs)
      : afterTcg;
    const tcgCountIn = afterFacetCoerced.length;
    const sortedIn = [...afterFacetCoerced].sort(
      (a, b) => (a.totalCost ?? 0) - (b.totalCost ?? 0),
    );
    const poolFloor =
      typeof poolFloorArg === "number"
        ? poolFloorArg
        : Math.max(
            config.resultsPerCard * destinations.length * 4,
            config.resultsPerCard * 10,
          );
    const hardCap = Number(process.env.EBAY_SHIP_LOOKUP_MAX_POOL) || 96;
    const poolCap = Math.min(
      hardCap,
      Math.max(poolFloor, config.resultsPerCard * 6),
    );
    const candidatePool = sortedIn.slice(
      0,
      Math.max(poolCap, config.resultsPerCard),
    );
    return {
      candidatePool,
      pipeline: {
        fetched: normalizedIn.length,
        afterLanguage: langCountIn,
        afterRelevance: relCountIn,
        afterListingFormat: fmtCountIn,
        afterTcgFocus: tcgCountIn,
        browseLanguageFacet: browseMeta.browseLanguageFacetActive,
        deliveryFilterRelaxed: browseMeta.deliveryFilterRelaxed,
        unrestrictedBrowse: browseMeta.unrestrictedBrowse,
        cardOnlyBrowseFallback: browseMeta.cardOnlyBrowseFallback ?? false,
        relevanceStats: relStats,
      },
      _normalizedLen: normalizedIn.length,
    };
  }


  let {
    summaries,
    deliveryFilterRelaxed,
    unrestrictedBrowse,
    browseLanguageFacetActive,
  } = await browseChain(query);

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
      browseLanguageFacetActive =
        browseLanguageFacetActive || again.browseLanguageFacetActive;
    }
  }

  if (summaries.length === 0) {
    console.warn(
      `[browse] No itemSummaries for q="${query.slice(0, 72)}" contextual=${browseCtxCountry} (${destKey} ship split) — try a shorter card name, confirm Production Buy Browse access, or mirror keywords on ebay.com.`,
    );
  }

  let payload = finalizeFromSummaries(summaries, {
    deliveryFilterRelaxed,
    unrestrictedBrowse,
    cardOnlyBrowseFallback: false,
    browseLanguageFacetActive,
  });

  if (
    payload.candidatePool.length === 0 &&
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
        browseLanguageFacetActive: wider.browseLanguageFacetActive,
      });
      if (payload2.candidatePool.length > 0) {
        payload = payload2;
      }
    }
  }

  const { lookups: shipLookups } = await enrichRowsShipToDestinations(
    payload.candidatePool,
    destinations,
    { getToken, on401 },
  );

  const itemsByCountry = {};
  for (const iso of destinations) {
    itemsByCountry[iso] = payload.candidatePool
      .filter((r) => r.shippingToBuyer?.[iso]?.eligible !== false)
      .slice(0, config.resultsPerCard);
  }

  const outPayload = {
    itemsByCountry,
    items: itemsByCountry[destinations[0]] ?? [],
    pipeline: {
      ...payload.pipeline,
      browseUsedDeliveryCountryFilter: false,
      shipToGetItemLookups: shipLookups,
    },
  };

  const { unrestrictedBrowse: ub, deliveryFilterRelaxed: dfr } =
    outPayload.pipeline;
  if (ub && outPayload.pipeline.fetched > 0) {
    console.warn(
      `[browse] Used unfiltered Browse + client-side BIN filter — verify ship-to (${destKey}) per listing.`,
    );
  } else if (dfr && outPayload.pipeline.fetched > 0) {
    console.warn(
      `[browse] Relaxed Browse (no BIN server filter); ship-to inferred per listing via Browse getItem + optional HTML.`,
    );
  }

  console.log(
    `[browse] Ship refinement: ${shipLookups} × getItem (${destKey}); counts ${destinations.map((iso) => `${iso}:${itemsByCountry[iso]?.length ?? 0}`).join(", ")}`,
  );

  const disk = (await readJsonCache(ACTIVE_CACHE, refresh ? 0 : ACTIVE_TTL_MS)) || {
    entries: {},
  };
  disk.entries = disk.entries || {};
  disk.entries[key] = outPayload;
  disk._expiresAt = Date.now() + ACTIVE_TTL_MS;
  await writeJsonCache(ACTIVE_CACHE, disk);

  return outPayload;
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
    languages: languagesOpt,
    lang: langLegacy,
    config,
    refresh,
    noEbay,
    getToken,
    on401,
    soldBrowser = false,
  },
) {
  const langs =
    languagesOpt && languagesOpt.length
      ? [...languagesOpt]
      : langLegacy && langLegacy !== "any"
        ? [langLegacy]
        : [];

  const relQ = relevanceQuery ?? query;
  const cacheKeyTag = "::soldLangFacet2";
  const key = `${query}::${listingLanguagesCacheTag(langs)}::${soldBrowser ? "pw" : "http"}${cacheKeyTag}`;
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
  const insightsLimit =
    langs.length > 0
      ? Math.min(200, Math.max(80, config.soldListingsLimit * 28))
      : Math.max(30, config.soldListingsLimit * 5);

  async function grabSoldHtmlFallback() {
    const fb = await fetchSoldHtmlFallback(query, relQ, {
      delayMs: 1000,
      soldBrowser,
      soldSacat: tcgSoldSacat(config),
    });
    items = fb.items;
    source = fb.tag;
  }

  const insightsCooldown = await marketplaceInsightsCooldownActive();
  let probeInsights = false;
  if (!insightsCooldown) {
    probeInsights = shouldProbeMarketplaceInsightsApi();
    if (!probeInsights) {
      if (envSkipsInsightsApi()) {
        logSoldInsightsBypassOnce(
          "env_skip",
          "EBAY_SKIP_MARKETPLACE_INSIGHTS",
        );
      } else if (!oauthScopeRequestsMarketplaceInsights()) {
        logSoldInsightsBypassOnce("no_scope_requested");
      } else if (!tokenGrantIncludedInsightsScope()) {
        logSoldInsightsBypassOnce("no_insights_grant");
      }
    }
  } else if (!warnedInsights403Cooldown) {
    warnedInsights403Cooldown = true;
    console.log(
      "[sold] Skipping Marketplace Insights (recent HTTP 403 — restricted API). Cooldown expires when `ebay-insights-forbidden-cache.json` ages out or `--refresh` removes it. Using HTML sold scrape.",
    );
  }

  if (!probeInsights) {
    await grabSoldHtmlFallback();
  } else {
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
      const errMsg = formatInsightsError(e);
      if (st === 403) {
        console.warn(
          `[insights] ${errMsg} (HTTP 403) — Marketplace Insights is limited-release on eBay (having the OAuth scope is not sufficient; approve via Application Growth Check if offered). Skipping Insight calls ~14 days. Using HTML sold scrape.`,
        );
        await markMarketplaceInsightsForbidden403(errMsg);
        warnedInsights403Cooldown = false;
      } else {
        console.warn(
          `[insights] ${errMsg} (HTTP ${st ?? "?"}) — using HTML fallback`,
        );
      }
      await grabSoldHtmlFallback();
    }
    if (items.length === 0 && source === "insights") {
      console.warn(
        `[insights] 0 sold rows from API for this query — using HTML fallback`,
      );
      await grabSoldHtmlFallback();
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

  let coarseForRelevance = mapped;
  if (langs.length === 0) {
    coarseForRelevance = filterByLanguage(mapped, "any");
  }
  const langCount = coarseForRelevance.length;

  const { filtered, stats } = filterRelevantResults(coarseForRelevance, relQ);
  const relCount = filtered.length;

  const afterFormat = filterByListingFormat(filtered, config);
  const fmtCount = afterFormat.length;
  const afterTcg = filterToLikelyTcgCards(afterFormat);
  const tcgCount = afterTcg.length;

  const sorted = [...afterTcg].sort((a, b) => {
    const da = Date.parse(a.endedDate) || 0;
    const db = Date.parse(b.endedDate) || 0;
    return db - da;
  });

  let top;
  let soldBrowseGetItemCalls = 0;
  if (langs.length > 0) {
    const ref = await refineSoldCompsBrowseLanguages(
      sorted,
      langs,
      config.soldListingsLimit,
      {
        getToken,
        on401,
        maxLookups: Math.min(sorted.length, 72),
      },
    );
    top = ref.rows;
    soldBrowseGetItemCalls = ref.apiCalls;
    console.log(
      `[sold] Browse Item Language [${langs.join(",")}]: ${top.length}/${config.soldListingsLimit} comps (${soldBrowseGetItemCalls} getItem, ${sorted.length} candidates)`,
    );
  } else {
    top = sorted.slice(0, config.soldListingsLimit);
  }

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
    soldBrowseGetItemCalls:
      langs.length > 0 ? soldBrowseGetItemCalls : 0,
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
      soldBrowseGetItemCalls:
        langs.length > 0 ? soldBrowseGetItemCalls : 0,
      relevanceStats: stats,
    },
  };
}

export async function testEbayAuth(clientId, clientSecret) {
  await getAccessToken(clientId, clientSecret);
  return true;
}

export { DAILY_CAP };
