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

export async function initCardDatabase() {
  const [enCards, jaCards] = await Promise.all([
    fetchCards("en").catch(() => []),
    fetchCards("ja").catch(() => []),
  ]);

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

  cardIndex = index;
  console.log(`Card database loaded: ${cardIndex.length} cards`);
  return cardIndex.length;
}

export async function refreshCardDatabase() {
  return initCardDatabase();
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
