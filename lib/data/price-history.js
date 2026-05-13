import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "price-history";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

function cardKey(query) {
  return query.toLowerCase().trim().replace(/[/\\. ]+/g, "_").substring(0, 200);
}

export async function recordSoldPrices(query, sold, source) {
  const fs = getDb();
  if (!fs || !sold?.length) return;

  const key = cardKey(query);
  const batch = fs.batch();
  const now = new Date().toISOString();

  for (const item of sold) {
    if (!item.price || item.price <= 0) continue;
    const docId = `${key}__${item.itemId || Date.now()}`;
    batch.set(fs.collection(COLLECTION).doc(docId), {
      cardKey: key,
      query,
      source: source || "ebay",
      price: item.price,
      currency: item.priceCurrency || "USD",
      priceJPY: item.priceJPY || null,
      soldDate: item.soldDate || item.endedDate || null,
      title: (item.title || "").substring(0, 120),
      listingGradeLabel: item.listingGradeLabel || null,
      recordedAt: now,
    }, { merge: true });
  }

  try { await batch.commit(); } catch {}
}

export async function getPriceHistory(query, { days = 90, limit = 200 } = {}) {
  const fs = getDb();
  if (!fs) return [];

  const key = cardKey(query);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const snap = await fs.collection(COLLECTION)
      .where("cardKey", "==", key)
      .where("recordedAt", ">=", cutoff)
      .orderBy("recordedAt", "desc")
      .limit(limit)
      .get();

    return snap.docs.map(d => {
      const data = d.data();
      return {
        price: data.price,
        currency: data.currency,
        priceJPY: data.priceJPY,
        soldDate: data.soldDate,
        source: data.source,
        listingGradeLabel: data.listingGradeLabel,
        recordedAt: data.recordedAt,
      };
    });
  } catch {
    return [];
  }
}

function findClosestPrice(sorted, targetDate) {
  let best = null;
  let bestDiff = Infinity;
  for (const item of sorted) {
    const diff = Math.abs(new Date(item.recordedAt).getTime() - targetDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = item; }
  }
  return best;
}

function avgPrice(items) {
  if (!items.length) return 0;
  return items.reduce((s, i) => s + i.price, 0) / items.length;
}

function computeChange(recentPrice, oldPrice) {
  if (!oldPrice || oldPrice <= 0) return null;
  const dollars = Math.round((recentPrice - oldPrice) * 100) / 100;
  const percent = Math.round(((recentPrice - oldPrice) / oldPrice) * 10000) / 100;
  return { percent, dollars };
}

export function computePriceTrend(history, now = new Date()) {
  if (!history || history.length < 3) return null;

  const valid = history.filter(h => h.price > 0 && h.recordedAt);
  if (valid.length < 3) return null;

  const sorted = [...valid].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  const dates = new Set(sorted.map(h => new Date(h.recordedAt).toDateString()));
  if (dates.size < 2) return null;

  const recentPrice = Math.round(avgPrice(sorted.slice(0, 3)) * 100) / 100;
  const avg30d = Math.round(avgPrice(sorted) * 100) / 100;

  function windowChange(items, days) {
    const target = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const older = items.filter(h => new Date(h.recordedAt) <= new Date(now.getTime() - days * 0.3 * 24 * 60 * 60 * 1000));
    if (!older.length) return null;
    const closest = findClosestPrice(older, target);
    if (!closest) return null;
    const change = computeChange(recentPrice, closest.price);
    if (!change) return null;
    return { ...change, dataPoints: older.length };
  }

  const change7d = windowChange(sorted, 7);
  const change30d = windowChange(sorted, 30);

  const primaryChange = change7d?.percent ?? change30d?.percent ?? 0;
  const direction = primaryChange < -3 ? "falling" : primaryChange > 3 ? "rising" : "stable";
  const signal = direction === "falling" && recentPrice < avg30d ? "good_buy"
    : direction === "rising" && recentPrice > avg30d ? "wait" : "fair";

  const bySource = {};
  const sourceGroups = {};
  for (const h of sorted) {
    const s = h.source || "unknown";
    if (!sourceGroups[s]) sourceGroups[s] = [];
    sourceGroups[s].push(h);
  }
  let bestSource = null;
  let bestSourceChange = Infinity;
  for (const [src, items] of Object.entries(sourceGroups)) {
    if (items.length < 2) continue;
    const srcRecent = Math.round(avgPrice(items.slice(0, Math.min(3, items.length))) * 100) / 100;
    const srcChange7d = windowChange(items, 7);
    bySource[src] = { recentPrice: srcRecent, change7d: srcChange7d, dataPoints: items.length };
    if (srcChange7d && srcChange7d.percent < bestSourceChange) {
      bestSourceChange = srcChange7d.percent;
      bestSource = src;
    }
  }

  const pct = Math.abs(primaryChange);
  const dir = primaryChange < 0 ? "Down" : primaryChange > 0 ? "Up" : "Flat";
  const period = change7d ? "this week" : "this month";
  let summary = pct < 1 ? `Stable ${period}` : `${dir} ${pct}% ${period}`;
  if (bestSource && bestSourceChange < -3 && direction !== "falling") {
    summary += ` (cheaper on ${bestSource})`;
  }

  return {
    recentPrice, direction, signal,
    change7d, change30d, avg30d,
    bySource, bestSource, summary,
    dataPoints: sorted.length,
  };
}
