import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";

const MAGI_BASE = "https://magi.camp/items/search";
const TRANSLATE_CACHE_FILE = "magi-translate-cache.json";

let _translateCache = null;
function translateCache() {
  if (!_translateCache) {
    try { _translateCache = JSON.parse(readFileSync(TRANSLATE_CACHE_FILE, "utf-8")); }
    catch { _translateCache = {}; }
  }
  return _translateCache;
}
function saveTranslateCache() {
  try { writeFileSync(TRANSLATE_CACHE_FILE, JSON.stringify(_translateCache, null, 2)); } catch {}
}

async function translateToJapanese(cardName, { log = console.log } = {}) {
  const key = cardName.toLowerCase().trim();
  const cache = translateCache();
  if (cache[key]) return cache[key];

  const apiKey = process.env.ANTHROPIC_HAIKU_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log(`  magi: "${cardName}" not in cache and no Anthropic key set — using English name`);
    return cardName;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 80,
        messages: [{
          role: "user",
          content: `Translate this Pokémon TCG card name to Japanese as it appears on magi.camp (a Japanese card marketplace). Rules: use the official Japanese game name for each Pokémon (e.g. Umbreon→ブラッキー, Charizard→リザードン, Groudon→グラードン, Kyogre→カイオーガ, Pikachu→ピカチュウ — NOT phonetic romanization); keep card numbers like 217/187 unchanged; keep "ex", "V", "VMAX", "VSTAR", "GX" unchanged; keep grading labels like "PSA 10" or "TAG 10" unchanged; translate set/descriptor words (e.g. "Alt Art"→SAR, "Team Magma's"→チームマグマの). Return ONLY the Japanese text, no explanation.\n\nCard: "${cardName}"`,
        }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
    const jp = data.content?.[0]?.text?.trim();
    if (!jp) throw new Error("empty response from API");
    log(`  magi: translated "${cardName}" → "${jp}"`);
    cache[key] = jp;
    saveTranslateCache();
    return jp;
  } catch (e) {
    log(`  magi: translation failed (${e.message}), using English name`);
    return cardName;
  }
}

async function fetchJPYRate() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.rates?.JPY ?? 155;
  } catch {
    return 155;
  }
}

function magiUrl(keyword, { status = "presented", sort = "price_asc", page = 1 } = {}) {
  const p = new URLSearchParams({
    "forms_search_items[keyword]": keyword,
    "forms_search_items[status]": status,
    "forms_search_items[sort]": sort,
    "forms_search_items[page]": String(page),
  });
  return `${MAGI_BASE}?${p}`;
}

function parseJPY(text) {
  const m = text?.match(/¥\s*([\d,]+)/);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

function gradeFromTitle(title) {
  const m1 = title?.match(/【\s*([A-Za-z]+)\s*(\d+(?:\.\d+)?)/);
  if (m1) return `${m1[1].toUpperCase()} ${m1[2]}`;
  const m2 = title?.match(/\b(PSA|BGS|CGC|TAG|SGC|HGA|ACE)\s?(\d+(?:\.\d+)?)\b/i);
  if (m2) return `${m2[1].toUpperCase()} ${m2[2]}`;
  return null;
}

async function scrapeListings(browser, keyword, { status, sort, limit }) {
  const page = await browser.newPage();
  try {
    await page.goto(magiUrl(keyword, { status, sort }), {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    return await page.evaluate((lim) =>
      Array.from(document.querySelectorAll("a[href*='/items/']"))
        .filter((a) => a.innerText?.includes("¥"))
        .slice(0, lim)
        .map((a) => {
          const lines = a.innerText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
          return {
            title: lines[0] || "",
            priceText: lines.find((l) => l.includes("¥")) || "",
            itemWebUrl: a.href,
            itemId: a.href.split("/items/").pop(),
          };
        }),
      limit,
    );
  } finally {
    await page.close();
  }
}

export async function searchMagi(card, config, { log = console.log } = {}) {
  const {
    resultsPerCard = 5,
    soldListingsLimit = 5,
    deliveryCountries = ["US", "IN"],
    listingFormat = "raw",
    slab,
  } = config;

  const jpCard = await translateToJapanese(card, { log });
  const query =
    listingFormat === "slab" && slab ? `${jpCard} ${slab.provider} ${slab.grade}` : jpCard;

  log(`  magi q: ${query}`);

  const [jpyPerUsd, browser] = await Promise.all([
    fetchJPYRate(),
    chromium.launch({ headless: true }),
  ]);

  try {
    const [activeRaw, soldRaw] = await Promise.all([
      scrapeListings(browser, query, { status: "presented", sort: "price_asc", limit: resultsPerCard }),
      scrapeListings(browser, query, { status: "sold_out", sort: "price_minimum_updated_at_desc", limit: soldListingsLimit }),
    ]);

    const toUSD = (jpy) => (jpy != null ? Math.round((jpy / jpyPerUsd) * 100) / 100 : null);

    const active = activeRaw.map((raw) => {
      const jpy = parseJPY(raw.priceText);
      const usd = toUSD(jpy);
      return {
        itemId: raw.itemId,
        itemWebUrl: raw.itemWebUrl,
        title: raw.title,
        price: usd,
        priceCurrency: "USD",
        priceJPY: jpy,
        shippingLabel: "—",
        totalCost: usd,
        listingGradeLabel: gradeFromTitle(raw.title),
        shippingToBuyer: Object.fromEntries(
          deliveryCountries.map((c) => [c, { eligible: null }]),
        ),
        grade: null,
      };
    });

    const sold = soldRaw.map((raw) => {
      const jpy = parseJPY(raw.priceText);
      return {
        itemId: raw.itemId,
        itemWebUrl: raw.itemWebUrl,
        title: raw.title,
        price: toUSD(jpy),
        currency: "USD",
        priceJPY: jpy,
        endedDate: "—",
        listingGradeLabel: gradeFromTitle(raw.title),
      };
    });

    log(
      `  magi: ${active.length} active, ${sold.length} sold (¥${Math.round(jpyPerUsd)}/USD)`,
    );

    const listingDesc =
      listingFormat === "slab" && slab
        ? `magi.camp — ${slab.provider} ${slab.grade} (¥${Math.round(jpyPerUsd)}/USD)`
        : `magi.camp (¥${Math.round(jpyPerUsd)}/USD)`;

    return {
      query: card,
      ebaySearchQuery: query,
      listingFormat,
      listingDescription: listingDesc,
      slab: listingFormat === "slab" ? { ...slab } : null,
      lang: "jp",
      activeByCountry: Object.fromEntries(deliveryCountries.map((c) => [c, active])),
      sold,
      gradingLabel: "magi listing",
      counts: { activeTotal: active.length, sold: sold.length },
      source: "magi",
    };
  } finally {
    await browser.close();
  }
}
