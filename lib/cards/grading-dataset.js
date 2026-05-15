import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "grading-dataset";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

export async function saveGradedImages(items, source) {
  const fs = getDb();
  if (!fs || !items?.length) return 0;

  let saved = 0;
  const batch = fs.batch();

  for (const item of items) {
    if (!item.listingGradeLabel || !item.imageUrl) continue;

    const gradeMatch = item.listingGradeLabel.match(/(?:PSA|BGS|CGC|TAG)\s*(\d+\.?\d*)/i);
    if (!gradeMatch) continue;

    const grade = parseFloat(gradeMatch[1]);
    if (grade < 1 || grade > 10) continue;

    const provider = item.listingGradeLabel.match(/PSA|BGS|CGC|TAG/i)?.[0]?.toUpperCase() || "UNKNOWN";
    const docId = `${source}_${item.itemId || Date.now()}_${saved}`;

    batch.set(fs.collection(COLLECTION).doc(docId), {
      imageUrl: item.imageUrl,
      additionalImages: (item.additionalImages || []).map(i => i.imageUrl).filter(Boolean).slice(0, 4),
      grade,
      provider,
      title: (item.title || "").substring(0, 150),
      price: item.price || null,
      source,
      soldDate: item.soldDate || null,
      collectedAt: new Date().toISOString(),
    }, { merge: true });

    saved++;
  }

  if (saved > 0) {
    try { await batch.commit(); } catch {}
  }
  return saved;
}

export async function getDatasetStats() {
  const fs = getDb();
  if (!fs) return { total: 0, byGrade: {}, byProvider: {} };

  try {
    const snap = await fs.collection(COLLECTION).limit(10000).get();
    const byGrade = {};
    const byProvider = {};

    for (const doc of snap.docs) {
      const d = doc.data();
      const g = String(d.grade);
      byGrade[g] = (byGrade[g] || 0) + 1;
      byProvider[d.provider] = (byProvider[d.provider] || 0) + 1;
    }

    return { total: snap.size, byGrade, byProvider };
  } catch {
    return { total: 0, byGrade: {}, byProvider: {} };
  }
}
