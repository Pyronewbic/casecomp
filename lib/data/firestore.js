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

export async function getActiveAlerts() {
  const fs = getDb();
  if (!fs) return [];
  const snap = await fs.collection("alerts").where("active", "==", true).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateAlert(id, data) {
  const fs = getDb();
  if (!fs) return null;
  const ref = fs.collection("alerts").doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  await ref.update(data);
  const updated = await ref.get();
  return { id: updated.id, ...updated.data() };
}

export async function getAlertsByEmail(email) {
  const fs = getDb();
  if (!fs) return [];
  const snap = await fs.collection("alerts").where("email", "==", email).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Portfolio ──

export async function getPortfolio(userId) {
  const fs = getDb();
  if (!fs) return [];
  try {
    const snap = await fs.collection("portfolios").doc(userId).collection("cards").get();
    return snap.docs.map(d => ({ ...d.data() }));
  } catch {
    return [];
  }
}

export async function addToPortfolio(userId, card) {
  const fs = getDb();
  if (!fs) return null;
  const docId = card.cardId.replace(/\//g, "_");
  const doc = {
    cardId: card.cardId,
    query: card.query || "",
    addedAt: card.addedAt || new Date().toISOString(),
    purchasePrice: card.purchasePrice || 0,
    purchaseSource: card.purchaseSource || "",
    quantity: card.quantity || 1,
    notes: card.notes || "",
  };
  await fs.collection("portfolios").doc(userId).collection("cards").doc(docId).set(doc);
  return doc;
}

export async function removeFromPortfolio(userId, cardId) {
  const fs = getDb();
  if (!fs) return false;
  const docId = cardId.replace(/\//g, "_");
  const ref = fs.collection("portfolios").doc(userId).collection("cards").doc(docId);
  const doc = await ref.get();
  if (!doc.exists) return false;
  await ref.delete();
  return true;
}

export async function updatePortfolioCard(userId, cardId, data) {
  const fs = getDb();
  if (!fs) return null;
  const docId = cardId.replace(/\//g, "_");
  const ref = fs.collection("portfolios").doc(userId).collection("cards").doc(docId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const allowed = {};
  if (data.purchasePrice != null) allowed.purchasePrice = Number(data.purchasePrice);
  if (data.quantity != null) allowed.quantity = Number(data.quantity);
  if (data.notes != null) allowed.notes = String(data.notes);
  if (data.purchaseSource != null) allowed.purchaseSource = String(data.purchaseSource);
  if (data.query != null) allowed.query = String(data.query);
  await ref.update(allowed);
  const updated = await ref.get();
  return updated.data();
}

// ── Error logs ──

export async function saveErrorLog(record) {
  const fs = getDb();
  if (!fs) return null;
  try {
    await fs.collection("error-logs").add({
      ...record,
      createdAt: Firestore.FieldValue.serverTimestamp(),
    });
  } catch {}
}

export async function clearErrorLogs() {
  const fs = getDb();
  if (!fs) return 0;
  try {
    const snap = await fs.collection("error-logs").limit(500).get();
    const batch = fs.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    return snap.docs.length;
  } catch { return 0; }
}

export async function getErrorLogs({ limit = 20 } = {}) {
  const fs = getDb();
  if (!fs) return [];
  try {
    const snap = await fs.collection("error-logs").orderBy("createdAt", "desc").limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
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

export async function cacheGetStale(collection, key) {
  const fs = getDb();
  if (!fs) return { value: null, stale: false };
  try {
    const doc = await fs.collection(collection).doc(key).get();
    if (!doc.exists) return { value: null, stale: false };
    const data = doc.data();
    const expired = data._expiresAt && data._expiresAt < Date.now();
    return { value: data.value ?? null, stale: !!expired };
  } catch {
    return { value: null, stale: false };
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
