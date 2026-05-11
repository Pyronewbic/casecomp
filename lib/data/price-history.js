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
