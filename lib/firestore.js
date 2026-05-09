import { Firestore } from "@google-cloud/firestore";

let db = null;
let available = false;

function getDb() {
  if (db) return db;
  try {
    db = new Firestore();
    available = true;
    return db;
  } catch {
    available = false;
    return null;
  }
}

export async function saveGradeLog(record) {
  const fs = getDb();
  if (!fs) return null;
  const ref = await fs.collection("grade-logs").add({
    ...record,
    createdAt: Firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function getGradeLogs({ limit = 100, query, source } = {}) {
  const fs = getDb();
  if (!fs) return [];
  let ref = fs.collection("grade-logs").orderBy("createdAt", "desc").limit(limit);
  if (source) ref = ref.where("source", "==", source);
  const snap = await ref.get();
  let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(r => (r.cardName || "").toLowerCase().includes(q));
  }
  return results;
}

export async function saveDrop(drop) {
  const fs = getDb();
  if (!fs) return null;
  await fs.collection("drops").doc(drop.id).set({
    ...drop,
    createdAt: Firestore.FieldValue.serverTimestamp(),
  });
  return drop.id;
}

export async function getDrops({ limit = 20, site, status } = {}) {
  const fs = getDb();
  if (!fs) return [];
  let ref = fs.collection("drops").orderBy("createdAt", "desc").limit(limit * 3);
  const snap = await ref.get();
  let results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (site) results = results.filter(r => (r.site || "").toLowerCase().includes(site.toLowerCase()));
  if (status) results = results.filter(r => r.status === status);
  return results.slice(0, limit);
}

export async function getDrop(id) {
  const fs = getDb();
  if (!fs) return null;
  const snap = await fs.collection("drops").where("id", "==", id).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function saveWebhook(webhook) {
  const fs = getDb();
  if (!fs) return null;
  await fs.collection("webhooks").doc(webhook.id).set(webhook);
  return webhook.id;
}

export async function getWebhooks(limit = 50) {
  const fs = getDb();
  if (!fs) return [];
  const snap = await fs.collection("webhooks").limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteWebhook(id) {
  const fs = getDb();
  if (!fs) return false;
  const snap = await fs.collection("webhooks").where("id", "==", id).limit(1).get();
  if (snap.empty) return false;
  await snap.docs[0].ref.delete();
  return true;
}

export async function saveAlert(alert) {
  const fs = getDb();
  if (!fs) return null;
  const ref = await fs.collection("alerts").add({
    ...alert,
    active: true,
    createdAt: Firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// ── Cache (replaces file-based JSON caches) ──

export async function cacheGet(collection, key) {
  const fs = getDb();
  if (!fs) return null;
  try {
    const doc = await fs.collection(collection).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (data._expiresAt && data._expiresAt < Date.now()) return null;
    return data.value ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(collection, key, value, ttlMs = 0) {
  const fs = getDb();
  if (!fs) return;
  try {
    const doc = { value, _writtenAt: Date.now() };
    if (ttlMs > 0) doc._expiresAt = Date.now() + ttlMs;
    await fs.collection(collection).doc(key).set(doc);
  } catch {}
}

export async function cacheDel(collection, key) {
  const fs = getDb();
  if (!fs) return;
  try {
    await fs.collection(collection).doc(key).delete();
  } catch {}
}

export async function getFirestoreStatus() {
  try {
    const fs = getDb();
    if (!fs) return { connected: false };
    const start = Date.now();
    await fs.collection("_health").doc("ping").set({ ts: Date.now() });
    return { connected: true, latencyMs: Date.now() - start };
  } catch {
    available = false;
    return { connected: false };
  }
}
