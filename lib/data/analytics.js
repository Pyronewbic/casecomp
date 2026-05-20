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

export async function getAnalyticsByUser(userId, { days = 7, limit = 500 } = {}) {
  const fs = getDb();
  if (!fs) return { total: 0, byPath: {}, avgLatencyMs: 0, daily: [] };

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const snap = await fs.collection(COLLECTION)
      .where("userId", "==", userId)
      .where("ts", ">=", cutoff)
      .orderBy("ts", "desc")
      .limit(limit)
      .get();

    const docs = snap.docs.map(d => d.data());
    const byPath = {};
    const daily = {};
    let totalLatency = 0;

    for (const d of docs) {
      byPath[d.path] = (byPath[d.path] || 0) + 1;
      totalLatency += d.latencyMs || 0;
      const day = d.ts?.split("T")[0];
      if (day) daily[day] = (daily[day] || 0) + 1;
    }

    return {
      total: docs.length,
      days,
      byPath,
      avgLatencyMs: docs.length > 0 ? Math.round(totalLatency / docs.length) : 0,
      daily: Object.entries(daily).sort().map(([date, count]) => ({ date, count })),
    };
  } catch {
    return { total: 0, byPath: {}, avgLatencyMs: 0, daily: [] };
  }
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
    const byStatus = {};
    const queries = {};
    const dailyMap = {};
    const users = new Set();
    let totalLatency = 0;

    for (const d of docs) {
      byTier[d.tier] = (byTier[d.tier] || 0) + 1;
      byPath[d.path] = (byPath[d.path] || 0) + 1;
      const sc = d.status ? String(d.status).charAt(0) + "xx" : "unknown";
      byStatus[sc] = (byStatus[sc] || 0) + 1;
      if (d.query) queries[d.query] = (queries[d.query] || 0) + 1;
      if (d.userId) users.add(d.userId);
      totalLatency += d.latencyMs || 0;
      const day = d.ts?.split("T")[0];
      if (day) {
        if (!dailyMap[day]) dailyMap[day] = { count: 0, latency: 0 };
        dailyMap[day].count++;
        dailyMap[day].latency += d.latencyMs || 0;
      }
    }

    const topQueries = Object.entries(queries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));

    const daily = Object.entries(dailyMap)
      .sort()
      .map(([date, v]) => ({ date, count: v.count, avgLatencyMs: v.count > 0 ? Math.round(v.latency / v.count) : 0 }));

    return {
      total,
      days,
      byTier,
      byPath,
      byStatus,
      topQueries,
      avgLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
      uniqueUsers: users.size,
      daily,
    };
  } catch {
    return { total: 0, byTier: {}, byPath: {}, topQueries: [], avgLatencyMs: 0 };
  }
}

