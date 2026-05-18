const BASE = "https://snkrdunk.com/en";
const API = `${BASE}/v1`;

const CONDITION_MAP = {
  18: { label: "A — Mint", raw: true },
  19: { label: "B — Minor scratches", raw: true },
  20: { label: "C", raw: true },
  21: { label: "D", raw: true },
  22: { label: "PSA 10", raw: false, provider: "PSA", grade: "10" },
  23: { label: "PSA 9", raw: false, provider: "PSA", grade: "9" },
  24: { label: "PSA 8-", raw: false, provider: "PSA", grade: "8" },
  25: { label: "BGS 10 BL", raw: false, provider: "BGS", grade: "10" },
  26: { label: "BGS 10 GL", raw: false, provider: "BGS", grade: "10" },
  27: { label: "BGS 9.5", raw: false, provider: "BGS", grade: "9.5" },
  28: { label: "BGS 9-", raw: false, provider: "BGS", grade: "9" },
  29: { label: "ARS 10+", raw: false, provider: "ARS", grade: "10" },
  30: { label: "ARS 10", raw: false, provider: "ARS", grade: "10" },
  31: { label: "ARS 9", raw: false, provider: "ARS", grade: "9" },
  32: { label: "ARS 8-", raw: false, provider: "ARS", grade: "8" },
  33: { label: "Other Graded", raw: false },
};

async function apiFetch(path, params = {}) {
  const qs = new URLSearchParams(params);
  const url = `${API}${path}?${qs}`;
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`snkrdunk ${res.status}: ${url}`);
  return res.json();
}

async function searchCards(keyword, { perPage = 21 } = {}) {
  const data = await apiFetch("/search", { keyword, perPage, page: 1, type: "" });
  return (data.streetwears || []).filter((r) => r.isTradingCard);
}

async function fetchUsedListings(productCode, { perPage = 20, page = 1, sortType = "latest", conditionID, isOnlyOnSale = false } = {}) {
  const params = { perPage, page, sortType, isOnlyOnSale };
  if (conditionID != null) params.conditionID = conditionID;
  const data = await apiFetch(`/products/${productCode}/used-listings`, params);
  return { listings: data.usedListings || [], product: data.product || null };
}

function conditionInfo(cond) {
  if (!cond) return { label: cond || "Unknown", raw: true };
  for (const [id, info] of Object.entries(CONDITION_MAP)) {
    if (info.label.startsWith(cond) || cond === String(id)) return info;
  }
  if (/^[A-D]$/i.test(cond)) {
    const letter = cond.toUpperCase();
    return Object.values(CONDITION_MAP).find((v) => v.label.startsWith(letter)) || { label: cond, raw: true };
  }
  return { label: cond, raw: true };
}

function gradeLabel(listing) {
  const info = conditionInfo(listing.condition);
  if (!info.raw && info.provider) return `${info.provider} ${info.grade}`;
  return null;
}

function listingUrl(listingUID) {
  return `${BASE}/trading-cards/used/listings/${listingUID}`;
}

async function fetchListingImages(listingUID) {
  const url = listingUrl(listingUID);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
  });
  if (!res.ok) return [];
  let html = await res.text();
  html = html.replace(/&amp;/g, "&").replace(/&#34;/g, '"').replace(/&#43;/g, "+");
  const m = html.match(/"imageUrls":\["https:\/\/cdn[^\]]*\]/);
  if (!m) return [];
  try { return JSON.parse(`{${m[0]}}`).imageUrls; } catch { return []; }
}

export function normalizeActive(raw, productName) {
  const info = conditionInfo(raw.condition);
  const desc = (raw.description || "").trim();
  const title = desc || productName || "";
  return {
    itemId: raw.listingUID || String(raw.id),
    itemWebUrl: listingUrl(raw.listingUID || raw.id),
    title: `${productName} [${info.label}]${desc ? ` — ${desc.slice(0, 80)}` : ""}`,
    price: raw.priceAmount ?? 0,
    priceCurrency: raw.currency || "USD",
    shippingLabel: "—",
    totalCost: raw.priceAmount ?? 0,
    condition: info.label,
    listingGradeLabel: gradeLabel(raw),
    imageUrl: raw.imageUrls?.[0] || raw.thumbnailUrl || null,
    additionalImages: (raw.imageUrls || []).slice(1).map((u) => ({ imageUrl: u })),
    shippingToBuyer: {},
    grade: null,
  };
}

export async function searchSnkrdunk(card, config, { log = console.log } = {}) {
  const {
    resultsPerCard = 5,
    soldListingsLimit = 5,
    deliveryCountries = ["US", "IN"],
    listingFormat = "raw",
    slab,
  } = config;

  log(`  snkrdunk search: "${card}"`);
  const hits = await searchCards(card);
  if (!hits.length) {
    log(`  snkrdunk: no products found for "${card}"`);
    return emptyResult(card, config);
  }

  const best = hits[0];
  const productCode = `SW---${best.id}`;
  log(`  snkrdunk match: ${best.name} (id=${best.id}, min=${best.minPriceFormat || best.minPrice})`);

  let conditionID;
  if (listingFormat === "slab" && slab) {
    conditionID = slabConditionId(slab.provider, slab.grade);
  } else if (config.condition) {
    conditionID = rawConditionId(config.condition);
  }

  const { listings, product } = await fetchUsedListings(productCode, {
    perPage: Math.max(resultsPerCard, soldListingsLimit) + 5,
    conditionID,
  });

  const productName = product?.name || best.name || card;
  log(`  snkrdunk: ${listings.length} listings fetched`);

  const normalized = listings.map((l) => normalizeActive(l, productName));

  const active = normalized
    .filter((item) => {
      if (listingFormat === "slab") return item.listingGradeLabel != null;
      return item.listingGradeLabel == null;
    })
    .slice(0, resultsPerCard);

  log(`  snkrdunk: fetching full images for ${active.length} listings…`);
  await Promise.all(active.map(async (item) => {
    const allImages = await fetchListingImages(item.itemId);
    if (allImages.length > 1) {
      item.imageUrl = allImages[0];
      item.additionalImages = allImages.slice(1).map((u) => ({ imageUrl: u }));
    }
  }));
  log(`  snkrdunk: images enriched (${active.reduce((n, i) => n + 1 + (i.additionalImages?.length || 0), 0)} total)`);

  active.forEach((item) => {
    item.shippingToBuyer = Object.fromEntries(
      deliveryCountries.map((c) => [c, { eligible: null }]),
    );
  });

  const listingDesc =
    listingFormat === "slab" && slab
      ? `SNKRDUNK — ${slab.provider} ${slab.grade} (USD)`
      : `SNKRDUNK (USD)`;

  return {
    query: card,
    ebaySearchQuery: card,
    listingFormat,
    listingDescription: listingDesc,
    slab: listingFormat === "slab" ? { ...slab } : null,
    lang: "any",
    activeByCountry: Object.fromEntries(deliveryCountries.map((c) => [c, active])),
    sold: [],
    soldSource: "snkrdunk",
    gradingLabel: "snkrdunk listing",
    counts: { activeTotal: active.length, sold: 0 },
    source: "snkrdunk",
  };
}

function rawConditionId(letter) {
  const upper = String(letter).toUpperCase();
  for (const [id, info] of Object.entries(CONDITION_MAP)) {
    if (info.raw && info.label.startsWith(upper)) return Number(id);
  }
  return undefined;
}

function slabConditionId(provider, grade) {
  const key = `${provider?.toUpperCase()} ${grade}`;
  for (const [id, info] of Object.entries(CONDITION_MAP)) {
    if (!info.raw && info.provider === provider?.toUpperCase()) {
      if (info.grade === String(grade)) return Number(id);
      if (info.label === key) return Number(id);
    }
  }
  return undefined;
}

function emptyResult(card, config) {
  return {
    query: card,
    ebaySearchQuery: card,
    listingFormat: config.listingFormat,
    listingDescription: "SNKRDUNK (USD)",
    slab: config.listingFormat === "slab" ? { ...config.slab } : null,
    lang: "any",
    activeByCountry: Object.fromEntries(
      (config.deliveryCountries || ["US", "IN"]).map((c) => [c, []]),
    ),
    sold: [],
    soldSource: "snkrdunk",
    gradingLabel: "snkrdunk listing",
    counts: { activeTotal: 0, sold: 0 },
    source: "snkrdunk",
  };
}
