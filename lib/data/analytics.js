import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "api-analytics";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

export async function logRequest(record) {
  const fs = getDb();
  if (!fs) return;
  try { await fs.collection(COLLECTION).add(record); } catch {}
}

export async function getAnalytics({ days = 7, limit = 1000 } = {}) {
  const fs = getDb();
  if (!fs) return { total: 0, byTier: {}, byPath: {}, topQueries: [], avgLatencyMs: 0 };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const snap = await fs.collection(COLLECTION)
      .where("ts", ">=", cutoff)
      .orderBy("ts", "desc")
      .limit(limit)
      .get();

    const docs = snap.docs.map(d => d.data());
    const total = docs.length;

    const byTier = {};
    const byPath = {};
    const queries = {};
    let totalLatency = 0;

    for (const d of docs) {
      byTier[d.tier] = (byTier[d.tier] || 0) + 1;
      byPath[d.path] = (byPath[d.path] || 0) + 1;
      if (d.query) queries[d.query] = (queries[d.query] || 0) + 1;
      totalLatency += d.latencyMs || 0;
    }

    const topQueries = Object.entries(queries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    return {
      total,
      days,
      byTier,
      byPath,
      topQueries,
      avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
    };
  } catch {
    return { total: 0, byTier: {}, byPath: {}, topQueries: [], avgLatencyMs: 0 };
  }
}
