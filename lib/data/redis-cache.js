import Redis from "ioredis";
import { readJsonCache, writeJsonCache, bustCaches, sha256 } from "./cache.js";

let redis = null;
let redisAvailable = false;

async function connect() {
  if (redis) return;
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  try {
    redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null });
    redis.on("error", () => {});
    await redis.connect();
    await redis.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    if (redis) { try { redis.disconnect(); } catch {} }
    redis = null;
  }
}

function redisKey(file, key) {
  const base = file.replace(/\.json$/, "");
  return `casecomp:${base}:${key}`;
}

export async function cacheRead(file, key, ttlMs = 0) {
  await connect();
  if (redisAvailable) {
    try {
      const val = await redis.get(redisKey(file, key));
      if (val) return JSON.parse(val);
    } catch {}
  }
  return readJsonCache(file, ttlMs);
}

export async function cacheWrite(file, key, data, ttlMs = 0) {
  await connect();
  if (redisAvailable && ttlMs > 0) {
    try {
      const ttlSec = Math.ceil(ttlMs / 1000);
      await redis.setex(redisKey(file, key), ttlSec, JSON.stringify(data));
    } catch {}
  }
  await writeJsonCache(file, data);
}

export async function cacheWritePermanent(key, data) {
  await connect();
  if (redisAvailable) {
    try {
      await redis.set(key, JSON.stringify(data));
    } catch {}
  }
}

export async function cacheReadByPattern(pattern, limit = 100) {
  await connect();
  if (!redisAvailable) return [];
  try {
    const keys = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      keys.push(...batch);
      if (keys.length >= limit) break;
    } while (cursor !== "0");
    const results = [];
    for (const k of keys.slice(0, limit)) {
      const val = await redis.get(k);
      if (val) results.push(JSON.parse(val));
    }
    return results;
  } catch {
    return [];
  }
}

export async function cacheBust(files) {
  await connect();
  if (redisAvailable) {
    try {
      for (const file of files) {
        const base = file.replace(/\.json$/, "");
        let cursor = "0";
        do {
          const [next, keys] = await redis.scan(cursor, "MATCH", `casecomp:${base}:*`, "COUNT", 200);
          cursor = next;
          if (keys.length) await redis.del(...keys);
        } while (cursor !== "0");
      }
    } catch {}
  }
  await bustCaches(files);
}

export async function getRedisStatus() {
  await connect();
  if (!redisAvailable) return { connected: false, host: process.env.REDIS_URL || "redis://127.0.0.1:6379", latencyMs: null };
  try {
    const start = Date.now();
    await redis.ping();
    return { connected: true, host: process.env.REDIS_URL || "redis://127.0.0.1:6379", latencyMs: Date.now() - start };
  } catch {
    return { connected: false, host: process.env.REDIS_URL || "redis://127.0.0.1:6379", latencyMs: null };
  }
}

export { sha256 };
