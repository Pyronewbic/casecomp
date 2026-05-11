import crypto from "crypto";
import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "api-keys";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function generateKey() {
  return `CC_LIVE_${crypto.randomBytes(24).toString("base64url")}`;
}

export async function createApiKey({ label, rateLimit = 60 }) {
  const fs = getDb();
  if (!fs) throw new Error("Firestore unavailable");

  const key = generateKey();
  const id = `key_${Date.now().toString(36)}`;
  const doc = {
    id,
    keyHash: hashKey(key),
    keyPrefix: key.slice(0, 16) + "...",
    label: label || "Unnamed",
    rateLimit: rateLimit || 60,
    active: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    requestCount: 0,
  };

  await fs.collection(COLLECTION).doc(id).set(doc);
  return { ...doc, key };
}

export async function listApiKeys() {
  const fs = getDb();
  if (!fs) return [];
  const snap = await fs.collection(COLLECTION).orderBy("createdAt", "desc").get();
  return snap.docs.map(d => d.data());
}

export async function getApiKey(id) {
  const fs = getDb();
  if (!fs) return null;
  const doc = await fs.collection(COLLECTION).doc(id).get();
  return doc.exists ? doc.data() : null;
}

export async function updateApiKey(id, updates) {
  const fs = getDb();
  if (!fs) throw new Error("Firestore unavailable");
  const doc = await fs.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  const allowed = {};
  if (updates.label !== undefined) allowed.label = updates.label;
  if (updates.rateLimit !== undefined) allowed.rateLimit = Number(updates.rateLimit);
  if (updates.active !== undefined) allowed.active = Boolean(updates.active);
  await fs.collection(COLLECTION).doc(id).update(allowed);
  return { ...doc.data(), ...allowed };
}

export async function deleteApiKey(id) {
  const fs = getDb();
  if (!fs) return false;
  const doc = await fs.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return false;
  await fs.collection(COLLECTION).doc(id).delete();
  return true;
}

export async function rotateApiKey(id) {
  const fs = getDb();
  if (!fs) throw new Error("Firestore unavailable");
  const doc = await fs.collection(COLLECTION).doc(id).get();
  if (!doc.exists) return null;
  const newKey = generateKey();
  await fs.collection(COLLECTION).doc(id).update({
    keyHash: hashKey(newKey),
    keyPrefix: newKey.slice(0, 16) + "...",
  });
  return { ...doc.data(), key: newKey, keyPrefix: newKey.slice(0, 16) + "..." };
}

let keyCache = null;
let keyCacheAt = 0;
const KEY_CACHE_TTL = 30_000;

export async function validateApiKey(token) {
  if (!token) return null;

  const now = Date.now();
  if (!keyCache || now - keyCacheAt > KEY_CACHE_TTL) {
    const fs = getDb();
    if (!fs) return null;
    const snap = await fs.collection(COLLECTION).where("active", "==", true).get();
    keyCache = snap.docs.map(d => d.data());
    keyCacheAt = now;
  }

  const hash = hashKey(token);
  const match = keyCache.find(k => k.keyHash === hash);
  if (!match) return null;

  const fs = getDb();
  if (fs) {
    fs.collection(COLLECTION).doc(match.id).update({
      lastUsedAt: new Date().toISOString(),
      requestCount: Firestore.FieldValue.increment(1),
    }).catch(() => {});
  }

  return match;
}
