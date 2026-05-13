import { Firestore } from "@google-cloud/firestore";
import { SET_NAME_MAP, SET_TOTAL_MAP } from "./card-identity.js";

const JA_TO_EN = {
  "ピカチュウ": "Pikachu", "リザードン": "Charizard", "ブラッキー": "Umbreon",
  "ゲッコウガ": "Greninja", "ミュウツー": "Mewtwo", "ミュウ": "Mew",
  "ルカリオ": "Lucario", "ゲンガー": "Gengar", "レックウザ": "Rayquaza",
  "カイリュー": "Dragonite", "ギャラドス": "Gyarados", "カメックス": "Blastoise",
  "フシギバナ": "Venusaur", "エーフィ": "Espeon", "ニンフィア": "Sylveon",
  "サーナイト": "Gardevoir", "ルギア": "Lugia", "ホウオウ": "Ho-Oh",
  "パルキア": "Palkia", "ディアルガ": "Dialga", "ギラティナ": "Giratina",
  "アルセウス": "Arceus", "ゼルネアス": "Xerneas", "イベルタル": "Yveltal",
  "ソルガレオ": "Solgaleo", "ルナアーラ": "Lunala", "ザシアン": "Zacian",
  "ザマゼンタ": "Zamazenta", "コライドン": "Koraidon", "ミライドン": "Miraidon",
  "リーフィア": "Leafeon", "グレイシア": "Glaceon", "ブースター": "Flareon",
  "シャワーズ": "Vaporeon", "サンダース": "Jolteon", "テラパゴス": "Terapagos",
  "ドラパルト": "Dragapult", "セグレイブ": "Baxcalibur", "ドドゲザン": "Kingambit",
  "マスカーニャ": "Meowscarada", "ラウドボーン": "Skeledirge", "ウェーニバル": "Quaquaval",
  "オーガポン": "Ogerpon", "テツノカイナ": "Iron Hands", "トドロクツキ": "Roaring Moon",
  "イーブイ": "Eevee", "ロトム": "Rotom", "ピジョット": "Pidgeot",
  "フーディン": "Alakazam", "カイリキー": "Machamp", "ハッサム": "Scizor",
  "バンギラス": "Tyranitar", "ボーマンダ": "Salamence", "メタグロス": "Metagross",
  "ガブリアス": "Garchomp", "エルレイド": "Gallade", "トゲキッス": "Togekiss",
  "ゾロアーク": "Zoroark", "サザンドラ": "Hydreigon", "バシャーモ": "Blaziken",
  "ジュカイン": "Sceptile", "ラグラージ": "Swampert", "ミミッキュ": "Mimikyu",
  "ドラゴンクロー": "Dragon Claw", "メガゲッコウガ": "Mega Greninja",
  "メガリザードン": "Mega Charizard", "メガミュウツー": "Mega Mewtwo",
  "メガレックウザ": "Mega Rayquaza", "メガルカリオ": "Mega Lucario",
  "メガゲンガー": "Mega Gengar", "メガハッサム": "Mega Scizor",
};

function translateJaName(jaName) {
  if (!jaName) return null;
  const sorted = Object.keys(JA_TO_EN).sort((a, b) => b.length - a.length);
  for (const ja of sorted) {
    if (jaName.startsWith(ja)) {
      const suffix = jaName.slice(ja.length);
      const enSuffix = suffix ? ` ${suffix}` : "";
      return `${JA_TO_EN[ja]}${enSuffix}`;
    }
  }
  return null;
}

let cardIndex = [];

async function fetchCards(lang, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards`, { signal: controller.signal });
    if (!res.ok) throw new Error(`TCGdex ${lang} returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseSetCode(id) {
  const m = id.match(/^([^-]+)-/);
  return m ? m[1] : null;
}

const setCodeToTotal = new Map();
for (const [total, code] of Object.entries(SET_TOTAL_MAP)) {
  setCodeToTotal.set(code, total);
}

function deriveSetTotals(index) {
  const maxBySet = new Map();
  for (const card of index) {
    if (!card.setCode || !card.localId) continue;
    const code = card.setCode.toLowerCase();
    const num = parseInt(card.localId, 10);
    if (Number.isNaN(num)) continue;
    if (!maxBySet.has(code) || num > maxBySet.get(code)) {
      maxBySet.set(code, num);
    }
  }
  let added = 0;
  for (const [code, max] of maxBySet) {
    if (!setCodeToTotal.has(code)) {
      setCodeToTotal.set(code, String(max));
      added++;
    }
  }
  if (added > 0) console.log(`Card database: derived ${added} new set totals from TCGdex (${setCodeToTotal.size} total sets)`);
}

function buildCanonicalCardId(setCode, localId) {
  if (!setCode || !localId) return null;
  const code = setCode.toLowerCase();
  const total = setCodeToTotal.get(code);
  if (!total) return null;
  return `${code}/${localId}-${total}`;
}

function buildImageUrl(image) {
  if (image) return `${image}/low.png`;
  return null;
}

const CACHE_COLLECTION = "card-database-cache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CHUNK_SIZE = 5000;

function getCacheDb() {
  try {
    return new Firestore();
  } catch {
    return null;
  }
}

export async function saveCardDatabaseToCache(index) {
  const fs = getCacheDb();
  if (!fs) return;
  try {
    const chunks = [];
    for (let i = 0; i < index.length; i += CHUNK_SIZE) {
      chunks.push(index.slice(i, i + CHUNK_SIZE));
    }
    const batch = fs.batch();
    for (let i = 0; i < chunks.length; i++) {
      const docId = chunks.length === 1 ? "index" : `index-${i}`;
      batch.set(fs.collection(CACHE_COLLECTION).doc(docId), {
        cards: JSON.stringify(chunks[i]),
        count: chunks[i].length,
        chunkIndex: i,
        totalChunks: chunks.length,
        updatedAt: Date.now(),
      });
    }
    batch.set(fs.collection(CACHE_COLLECTION).doc("meta"), {
      totalCards: index.length,
      totalChunks: chunks.length,
      updatedAt: Date.now(),
    });
    await batch.commit();
  } catch {}
}

export async function loadCardDatabaseFromCache() {
  const fs = getCacheDb();
  if (!fs) return null;
  try {
    const metaDoc = await fs.collection(CACHE_COLLECTION).doc("meta").get();
    if (!metaDoc.exists) return null;
    const meta = metaDoc.data();
    if (Date.now() - meta.updatedAt > CACHE_TTL_MS) return null;

    const chunks = meta.totalChunks;
    const docs = [];
    if (chunks === 1) {
      const doc = await fs.collection(CACHE_COLLECTION).doc("index").get();
      if (!doc.exists) return null;
      docs.push(doc);
    } else {
      for (let i = 0; i < chunks; i++) {
        const doc = await fs.collection(CACHE_COLLECTION).doc(`index-${i}`).get();
        if (!doc.exists) return null;
        docs.push(doc);
      }
    }

    const index = [];
    for (const doc of docs) {
      const parsed = JSON.parse(doc.data().cards);
      index.push(...parsed);
    }
    return index;
  } catch {
    return null;
  }
}

function buildIndexFromApi(enCards, jaCards) {
  const jaMap = new Map();
  for (const card of jaCards) {
    jaMap.set(card.id, card);
  }

  const seen = new Set();
  const index = [];

  for (const card of enCards) {
    seen.add(card.id);
    const setCode = parseSetCode(card.id);
    const jaCard = jaMap.get(card.id);
    index.push({
      id: card.id,
      name: card.name,
      nameJa: jaCard?.name || null,
      localId: card.localId,
      setCode,
      imageUrl: buildImageUrl(card.image),
    });
  }

  for (const card of jaCards) {
    if (seen.has(card.id)) continue;
    const setCode = parseSetCode(card.id);
    const enName = translateJaName(card.name);
    index.push({
      id: card.id,
      name: enName || card.name,
      nameJa: card.name,
      localId: card.localId,
      setCode,
      imageUrl: buildImageUrl(card.image),
    });
  }

  return index;
}

async function fetchAndBuildIndex() {
  const [enCards, jaCards] = await Promise.all([
    fetchCards("en").catch(() => []),
    fetchCards("ja").catch(() => []),
  ]);
  if (!enCards.length && !jaCards.length) return null;
  return buildIndexFromApi(enCards, jaCards);
}

export async function initCardDatabase() {
  const cached = await loadCardDatabaseFromCache();
  if (cached && cached.length > 0) {
    cardIndex = cached;
    deriveSetTotals(cardIndex);
    console.log(`Card database loaded from cache: ${cardIndex.length} cards`);

    fetchAndBuildIndex().then(async (freshIndex) => {
      if (freshIndex && freshIndex.length > 0) {
        cardIndex = freshIndex;
        deriveSetTotals(cardIndex);
        console.log(`Card database refreshed from TCGdex: ${cardIndex.length} cards`);
        await saveCardDatabaseToCache(freshIndex);
      }
    }).catch(() => {});

    return cardIndex.length;
  }

  const freshIndex = await fetchAndBuildIndex();
  if (freshIndex && freshIndex.length > 0) {
    cardIndex = freshIndex;
    deriveSetTotals(cardIndex);
    console.log(`Card database loaded from TCGdex: ${cardIndex.length} cards`);
    saveCardDatabaseToCache(freshIndex).catch(() => {});
    return cardIndex.length;
  }

  console.log("Card database empty: TCGdex unavailable, no cache");
  return 0;
}

export async function refreshCardDatabase() {
  const freshIndex = await fetchAndBuildIndex();
  if (freshIndex && freshIndex.length > 0) {
    cardIndex = freshIndex;
    console.log(`Card database refreshed from TCGdex: ${cardIndex.length} cards`);
    saveCardDatabaseToCache(freshIndex).catch(() => {});
    return cardIndex.length;
  }
  return cardIndex.length;
}

export function getCardCount() {
  return cardIndex.length;
}

export function matchesQuery(card, query) {
  if (!query || query.length < 2) return 0;
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;

  const nameLower = (card.name || "").toLowerCase();
  const nameJa = card.nameJa || "";
  const idLower = (card.id || "").toLowerCase();
  const localId = card.localId || "";

  if (tokens.length === 1) {
    const t = tokens[0];
    if (nameLower.startsWith(t)) return 3;
    if (nameJa.startsWith(t)) return 3;
    if (nameLower.includes(t)) return 2;
    if (nameJa.includes(t)) return 2;
    if (localId.startsWith(t)) return 1;
    if (idLower.includes(t)) return 1;
    return 0;
  }

  const nameFields = `${nameLower} ${nameJa.toLowerCase()}`;
  const combined = `${nameFields} ${idLower} ${localId}`.toLowerCase();

  const allInName = tokens.every(t => nameFields.includes(t));
  if (allInName) {
    return nameLower.startsWith(tokens[0]) || nameJa.startsWith(tokens[0]) ? 4 : 3;
  }

  const allInCombined = tokens.every(t => combined.includes(t));
  if (allInCombined) {
    const hasLocalIdMatch = tokens.some(t => localId === t || localId.startsWith(t));
    const hasNameMatch = tokens.some(t => nameLower.startsWith(t) || nameJa.startsWith(t));
    if (hasLocalIdMatch && hasNameMatch) return 5;
    return 1;
  }

  const nameMatched = tokens.filter(t => nameFields.includes(t));
  if (nameMatched.length >= 2 && (nameLower.startsWith(tokens[0]) || nameJa.startsWith(tokens[0]))) {
    return 1 + Math.min(nameMatched.length / tokens.length, 1);
  }

  if (nameMatched.length >= 1 && tokens.some(t => nameLower.startsWith(t) || nameJa.startsWith(t))) {
    return 1 + Math.min(nameMatched.length / tokens.length, 0.5);
  }

  return 0;
}

export function searchCards(query, limit = 8) {
  if (!query || query.length < 2) return [];

  const scored = [];
  for (const card of cardIndex) {
    const score = matchesQuery(card, query);
    if (score > 0) scored.push({ card, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aImg = a.card.imageUrl ? 0 : 1;
    const bImg = b.card.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return (a.card.name || "").localeCompare(b.card.name || "");
  });

  return scored.slice(0, limit).map(({ card }) => ({
    id: card.id,
    cardId: buildCanonicalCardId(card.setCode, card.localId),
    name: card.name,
    nameJa: card.nameJa,
    setCode: card.setCode,
    setName: (card.setCode && SET_NAME_MAP[card.setCode.toLowerCase()]) || card.setCode || null,
    localId: card.localId,
    imageUrl: card.imageUrl,
  }));
}
