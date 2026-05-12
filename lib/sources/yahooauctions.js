import * as cheerio from "cheerio";
import { translateToJapanese, fetchJPYRate } from "./magi.js";

const YAHOO_SEARCH = "https://auctions.yahoo.co.jp/search/search";
const YAHOO_CLOSED = "https://auctions.yahoo.co.jp/closedsearch/closedsearch";
const POKEMON_TCG_CAT = "2084241343";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

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

async function scrapeActive(keyword, limit) {
  const url = searchUrl(keyword);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const results = [];

  $(".Product__detail").each((_, el) => {
    if (results.length >= limit) return false;
    const $el = $(el);
    const link = $el.find(".Product__titleLink");
    const bonus = $el.find(".Product__bonus");
    if (!link.length) return;

    const title = link.attr("data-auction-title") || link.text().trim() || "";
    if (!title) return;

    const auctionId = bonus.attr("data-auction-id") || link.attr("data-auction-id") || "";

    let price = 0;
    const buynow = parseInt(bonus.attr("data-auction-buynowprice"), 10);
    if (buynow > 0) {
      price = buynow;
    } else {
      const current = parseInt(bonus.attr("data-auction-price") || link.attr("data-auction-price"), 10);
      if (current > 0) {
        price = current;
      } else {
        const priceEl = $el.find(".Product__priceValue");
        if (priceEl.length) {
          const m = priceEl.text()?.replace(/[^0-9]/g, "");
          if (m) price = parseInt(m, 10) || 0;
        }
      }
    }

    const img = link.attr("data-auction-img") || "";
    const href = link.attr("href") || "";

    results.push({ title, auctionId, price, img, href });
  });

  return results;
}

async function scrapeSold(keyword, limit) {
  const url = closedUrl(keyword);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const seen = new Set();
  const results = [];

  $('a[href*="/jp/auction/"]').each((_, el) => {
    if (results.length >= limit) return false;
    const $a = $(el);
    const title = $a.text().trim();
    if (!title || title.length < 5) return;

    const href = $a.attr("href") || "";
    const auctionId = href.split("/auction/").pop() || "";
    if (seen.has(auctionId)) return;
    seen.add(auctionId);

    const clParams = $a.attr("data-cl-params") || "";
    const pm = clParams.match(/etc:p=([0-9]+)/);
    let price = pm ? parseInt(pm[1], 10) : 0;
    if (!price) {
      const container = $a.parent();
      const text = container.text() || "";
      const ym = text.match(/([0-9,]+)\s*円/);
      if (ym) price = parseInt(ym[1].replace(/,/g, ""), 10) || 0;
    }

    results.push({ title, auctionId, price, href });
  });

  return results;
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

  const [jpyPerUsd, activeRaw, soldRaw] = await Promise.all([
    fetchJPYRate(),
    scrapeActive(query, resultsPerCard),
    scrapeSold(query, soldListingsLimit),
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
}
