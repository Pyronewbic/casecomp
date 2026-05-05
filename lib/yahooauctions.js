import { chromium } from "playwright";
import { translateToJapanese, fetchJPYRate } from "./magi.js";

const YAHOO_SEARCH = "https://auctions.yahoo.co.jp/search/search";
const YAHOO_CLOSED = "https://auctions.yahoo.co.jp/closedsearch/closedsearch";
const POKEMON_TCG_CAT = "2084241343";

function searchUrl(keyword, { sort = "cbids", order = "a", n = 50 } = {}) {
  const p = new URLSearchParams({
    p: keyword,
    auccat: POKEMON_TCG_CAT,
    n: String(n),
    s1: sort,
    o1: order,
  });
  return `${YAHOO_SEARCH}?${p}`;
}

function closedUrl(keyword, { n = 50 } = {}) {
  const p = new URLSearchParams({
    p: keyword,
    auccat: POKEMON_TCG_CAT,
    n: String(n),
  });
  return `${YAHOO_CLOSED}?${p}`;
}

function gradeFromTitle(title) {
  const m1 = title?.match(/【\s*([A-Za-z]+)\s*(\d+(?:\.\d+)?)/);
  if (m1) return `${m1[1].toUpperCase()} ${m1[2]}`;
  const m2 = title?.match(/\b(PSA|BGS|CGC|TAG|SGC|HGA|ACE)\s?(\d+(?:\.\d+)?)\b/i);
  if (m2) return `${m2[1].toUpperCase()} ${m2[2]}`;
  return null;
}

async function scrapeActive(browser, keyword, limit) {
  const page = await browser.newPage();
  try {
    await page.goto(searchUrl(keyword), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    const items = await page.evaluate(({ lim, extractPriceFn }) => {
      function getPrice(el) {
        const bonus = el.querySelector(".Product__bonus");
        const link = el.querySelector(".Product__titleLink");
        const buynow = parseInt(bonus?.getAttribute("data-auction-buynowprice"), 10);
        if (buynow > 0) return buynow;
        const current = parseInt(bonus?.getAttribute("data-auction-price") || link?.getAttribute("data-auction-price"), 10);
        if (current > 0) return current;
        const priceEl = el.querySelector(".Product__priceValue");
        if (priceEl) {
          const m = priceEl.textContent?.replace(/[^0-9]/g, "");
          if (m) return parseInt(m, 10) || 0;
        }
        return 0;
      }

      const results = [];
      const els = document.querySelectorAll(".Product__detail");
      for (const el of els) {
        if (results.length >= lim) break;
        const link = el.querySelector(".Product__titleLink");
        const bonus = el.querySelector(".Product__bonus");
        if (!link) continue;
        const title = link.getAttribute("data-auction-title") || link.textContent?.trim() || "";
        const auctionId = bonus?.getAttribute("data-auction-id") || link.getAttribute("data-auction-id") || "";
        const price = getPrice(el);
        const img = link.getAttribute("data-auction-img") || "";
        const href = link.href || "";
        if (!title) continue;
        results.push({ title, auctionId, price, img, href });
      }
      return results;
    }, { lim: limit });

    return items;
  } finally {
    await page.close();
  }
}

async function scrapeSold(browser, keyword, limit) {
  const page = await browser.newPage();
  try {
    await page.goto(closedUrl(keyword), { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    const items = await page.evaluate((lim) => {
      const seen = new Set();
      const results = [];
      const links = document.querySelectorAll('a[href*="/jp/auction/"]');
      for (const a of links) {
        if (results.length >= lim) break;
        const title = a.textContent?.trim();
        if (!title || title.length < 5) continue;
        const href = a.href || "";
        const auctionId = href.split("/auction/").pop() || "";
        if (seen.has(auctionId)) continue;
        seen.add(auctionId);
        const clParams = a.getAttribute("data-cl-params") || "";
        const pm = clParams.match(/etc:p=([0-9]+)/);
        let price = pm ? parseInt(pm[1], 10) : 0;
        if (!price) {
          const container = a.closest("[class*='sc-']") || a.parentElement;
          const text = container?.textContent || "";
          const ym = text.match(/([0-9,]+)\s*円/);
          if (ym) price = parseInt(ym[1].replace(/,/g, ""), 10) || 0;
        }
        results.push({ title, auctionId, price, href });
      }
      return results;
    }, limit);

    return items;
  } finally {
    await page.close();
  }
}

export async function searchYahooAuctions(card, config, { log = console.log } = {}) {
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

  log(`  yahoo q: ${query}`);

  const [jpyPerUsd, browser] = await Promise.all([
    fetchJPYRate(),
    chromium.launch({ headless: true }),
  ]);

  try {
    const [activeRaw, soldRaw] = await Promise.all([
      scrapeActive(browser, query, resultsPerCard),
      scrapeSold(browser, query, soldListingsLimit),
    ]);

    const toUSD = (jpy) => (jpy != null && jpy > 0 ? Math.round((jpy / jpyPerUsd) * 100) / 100 : null);

    const auctionUrl = (item) =>
      item.href || `https://page.auctions.yahoo.co.jp/jp/auction/${item.auctionId}`;

    const active = activeRaw
      .map((raw) => ({
        itemId: raw.auctionId,
        itemWebUrl: auctionUrl(raw),
        title: raw.title,
        price: toUSD(raw.price),
        priceCurrency: "USD",
        priceJPY: raw.price,
        shippingLabel: "—",
        totalCost: toUSD(raw.price),
        listingGradeLabel: gradeFromTitle(raw.title),
        shippingToBuyer: Object.fromEntries(
          deliveryCountries.map((c) => [c, { eligible: null }]),
        ),
        grade: null,
      }))
      .filter((r) => listingFormat !== "raw" || r.listingGradeLabel == null);

    const sold = soldRaw
      .map((raw) => ({
        itemId: raw.auctionId,
        itemWebUrl: auctionUrl(raw),
        title: raw.title,
        price: toUSD(raw.price),
        currency: "USD",
        priceJPY: raw.price,
        endedDate: "—",
        listingGradeLabel: gradeFromTitle(raw.title),
      }))
      .filter((r) => listingFormat !== "raw" || r.listingGradeLabel == null);

    log(`  yahoo: ${active.length} active, ${sold.length} sold (¥${Math.round(jpyPerUsd)}/USD)`);

    const listingDesc =
      listingFormat === "slab" && slab
        ? `Yahoo Auctions JP — ${slab.provider} ${slab.grade} (¥${Math.round(jpyPerUsd)}/USD)`
        : `Yahoo Auctions JP (¥${Math.round(jpyPerUsd)}/USD)`;

    return {
      query: card,
      ebaySearchQuery: query,
      listingFormat,
      listingDescription: listingDesc,
      slab: listingFormat === "slab" ? { ...slab } : null,
      lang: "jp",
      activeByCountry: Object.fromEntries(deliveryCountries.map((c) => [c, active])),
      sold,
      gradingLabel: "yahoo listing",
      counts: { activeTotal: active.length, sold: sold.length },
      source: "yahoo",
    };
  } finally {
    await browser.close();
  }
}
