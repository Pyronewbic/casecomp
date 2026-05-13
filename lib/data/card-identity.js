import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "cards";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

function extractCardNumber(text) {
  const m = text.match(/(\d{1,3})\s*\/\s*(\d{2,3})/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export const SET_TOTAL_MAP = {
  // Scarlet & Violet era (JP)
  "78": "sv5k",     // Wild Force
  "81": "sv5m",     // Cyber Judge (sub)
  "83": "m4",       // Ninja Spinner
  "88": "sv6a",     // Night Wanderer
  "101": "sv7a",    // Stellar Miracle
  "108": "sv5a",    // Crimson Haze
  "131": "sv6",     // Transformation Mask
  "140": "sv3a",    // Raging Surf
  "150": "sv8",     // Surging Sparks
  "165": "sv2a",    // Pokemon Card 151
  "173": "sv5m",    // Cyber Judge
  "178": "sv4m",    // Super Electric Breaker
  "183": "sv7",     // Stellar Crown
  "187": "sv8a",    // Terastal Festival ex
  "190": "sv4a",    // Shiny Treasure ex
  "193": "m2a",     // Mega Dream ex
  "196": "sv3",     // Ruler of the Black Flame
  "215": "sv1",     // Scarlet ex / Violet ex
  "230": "sv2",     // Snow Hazard / Clay Burst

  // Scarlet & Violet era (ENG)
  "198": "sv1en",   // Scarlet & Violet Base
  "207": "sv2en",   // Paldea Evolved
  "228": "sv3en",   // Obsidian Flames
  "258": "sv4en",   // Paradox Rift
  "210": "sv5en",   // Temporal Forces
  "230": "sv6en",   // Twilight Masquerade
  "175": "sv3pt5en", // 151 English
  "234": "sv7en",   // Stellar Crown EN
  "268": "sv8en",   // Surging Sparks EN

  // Sword & Shield era
  "185": "swsh1",   // Sword & Shield Base
  "192": "swsh2",   // Rebel Clash
  "189": "swsh3",   // Darkness Ablaze
  "185": "swsh3.5", // Champion's Path
  "190": "swsh4",   // Vivid Voltage (note: conflicts with sv4a)
  "184": "swsh4",   // Vivid Voltage (alternate total)
  "198": "swsh5",   // Battle Styles
  "233": "swsh6",   // Chilling Reign
  "203": "swsh7",   // Evolving Skies
  "264": "swsh8",   // Fusion Strike
  "172": "swsh9",   // Brilliant Stars
  "216": "swsh10",  // Astral Radiance
  "196": "swsh11",  // Lost Origin
  "195": "swsh12",  // Silver Tempest
  "271": "swsh12.5",// Crown Zenith
  "300": "swsh12pt5",

  // Sun & Moon era
  "149": "sm1",     // Sun & Moon Base
  "145": "sm2",     // Guardians Rising
  "147": "sm3",     // Burning Shadows
  "111": "sm3.5",   // Shining Legends
  "156": "sm4",     // Crimson Invasion
  "173": "sm5",     // Ultra Prism
  "163": "sm6",     // Forbidden Light
  "168": "sm7",     // Celestial Storm
  "214": "sm8",     // Lost Thunder
  "181": "sm9",     // Team Up
  "210": "sm10",    // Unbroken Bonds
  "236": "sm11",    // Unified Minds
  "236": "sm12",    // Cosmic Eclipse

  // XY era
  "146": "xy1",     // XY Base
  "119": "xy2",     // Flashfire
  "111": "xy3",     // Furious Fists
  "119": "xy4",     // Phantom Forces
  "119": "xy5",     // Primal Clash
  "108": "xy6",     // Roaring Skies
  "98": "xy7",      // Ancient Origins
  "162": "xy8",     // BREAKthrough
  "122": "xy9",     // BREAKpoint
  "124": "xy10",    // Fates Collide
  "114": "xy11",    // Steam Siege
  "113": "xy12",    // Evolutions

  // JP S-era (Sword & Shield JP)
  "127": "s1",      // Sword
  "96": "s2",       // Rebellion Crash
  "116": "s3",      // Infinity Zone
  "100": "s4",      // Astonishing Volt Tackle
  "88": "s5",       // Rapid/Single Strike
  "116": "s6",      // Eevee Heroes
  "98": "s7",       // Blue Sky Stream / Skyscraping Perfection
  "100": "s8",      // Fusion Arts
  "130": "s9",      // Star Birth
  "98": "s10",      // Space Juggler / Time Gazer
  "71": "s11",      // Lost Abyss
  "98": "s12",      // Paradigm Trigger
};

function extractSetCode(text) {
  const codes = [
    /\b(sv\d+[a-z]?)\b/i,
    /\b(s\d+[a-z]?)\b/i,
    /\b(m\d+[a-z]?)\b/i,
    /\b(swsh\d+)\b/i,
    /\b(sm\d+[a-z]?)\b/i,
    /\b(xy\d+[a-z]?)\b/i,
  ];
  for (const re of codes) {
    const m = text.match(re);
    if (m) return m[1].toLowerCase();
  }

  const numMatch = text.match(/\d{1,3}\s*\/\s*(\d{2,3})/);
  if (numMatch) {
    const total = numMatch[1];
    if (SET_TOTAL_MAP[total]) return SET_TOTAL_MAP[total];
  }

  const setNames = {
    // SV era JP
    "terastal festival": "sv8a", "テラスタルフェスタ": "sv8a",
    "night wanderer": "sv6a", "ナイトワンダラー": "sv6a",
    "mega dream": "m2a", "メガドリーム": "m2a",
    "ninja spinner": "m4", "ニンジャスピナー": "m4",
    "shiny treasure": "sv4a", "シャイニートレジャー": "sv4a",
    "crimson haze": "sv5a", "クリムゾンヘイズ": "sv5a",
    "wild force": "sv5k", "ワイルドフォース": "sv5k",
    "cyber judge": "sv5m", "サイバージャッジ": "sv5m",
    "transformation mask": "sv6", "変幻の仮面": "sv6",
    "stellar miracle": "sv7a", "ステラミラクル": "sv7a",
    "surging sparks": "sv8", "スパークス": "sv8",
    "ruler of the black flame": "sv3", "黒炎の支配者": "sv3",
    "raging surf": "sv3a", "レイジングサーフ": "sv3a",
    "151": "sv2a",
    "stellar crown": "sv7",
    // SV era EN
    "scarlet & violet": "sv1en", "scarlet and violet": "sv1en",
    "paldea evolved": "sv2en",
    "obsidian flames": "sv3en",
    "paradox rift": "sv4en",
    "temporal forces": "sv5en",
    "twilight masquerade": "sv6en",
    // SWSH era
    "evolving skies": "swsh7",
    "fusion strike": "swsh8",
    "brilliant stars": "swsh9",
    "astral radiance": "swsh10",
    "lost origin": "swsh11",
    "silver tempest": "swsh12",
    "crown zenith": "swsh12.5",
    "vivid voltage": "swsh4",
    "chilling reign": "swsh6",
    "battle styles": "swsh5",
    "darkness ablaze": "swsh3",
    "rebel clash": "swsh2",
    "champion's path": "swsh3.5",
    // SM era
    "team up": "sm9",
    "unbroken bonds": "sm10",
    "unified minds": "sm11",
    "cosmic eclipse": "sm12",
    "lost thunder": "sm8",
    "celestial storm": "sm7",
    "ultra prism": "sm5",
    "burning shadows": "sm3",
    "guardians rising": "sm2",
    "shining legends": "sm3.5",
    // JP S-era
    "eevee heroes": "s6", "イーブイヒーローズ": "s6",
    "fusion arts": "s8", "フュージョンアーツ": "s8",
    "star birth": "s9", "スターバース": "s9",
    "vstar universe": "s12a", "vstarユニバース": "s12a",
    "lost abyss": "s11", "ロストアビス": "s11",
  };
  const lower = text.toLowerCase();
  for (const [name, code] of Object.entries(setNames)) {
    if (lower.includes(name)) return code;
  }

  return null;
}

function extractRarity(text) {
  const t = text.toUpperCase();
  const rarities = ["SAR", "SR", "AR", "UR", "HR", "CHR", "CSR", "SSR", "SIR", "IR", "ACE"];
  for (const r of rarities) {
    if (new RegExp(`\\b${r}\\b`).test(t)) return r;
  }
  return null;
}

function extractPokemonName(text) {
  const cleaned = text
    .replace(/\d{1,3}\s*\/\s*\d{2,3}/g, "")
    .replace(/\b(sv\d+[a-z]?|s\d+[a-z]?|m\d+[a-z]?|swsh\d+|sm\d+[a-z]?)\b/gi, "")
    .replace(/\b(SAR|SR|AR|UR|HR|CHR|CSR|SSR|SIR|IR|ACE|PSA|BGS|CGC|TAG)\b/gi, "")
    .replace(/\b(japanese|japan|jp|english|eng|pokemon|tcg|card|holo|reverse|promo)\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/[^\w\s　-ヿ぀-ゟ一-龯＀-ﾟ'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export const SET_NAME_MAP = {
  "m2a": "Mega Dream ex", "m4": "Ninja Spinner",
  "sv8a": "Terastal Festival ex", "sv8": "Surging Sparks",
  "sv7": "Stellar Crown", "sv7a": "Stellar Miracle",
  "sv6": "Transformation Mask", "sv6a": "Night Wanderer",
  "sv5a": "Crimson Haze", "sv5k": "Wild Force", "sv5m": "Cyber Judge",
  "sv4a": "Shiny Treasure ex", "sv4m": "Super Electric Breaker",
  "sv3": "Ruler of the Black Flame", "sv3a": "Raging Surf",
  "sv2a": "Pokemon Card 151", "sv2": "Snow Hazard / Clay Burst",
  "sv1": "Scarlet ex / Violet ex",
  "sv1en": "Scarlet & Violet", "sv2en": "Paldea Evolved",
  "sv3en": "Obsidian Flames", "sv4en": "Paradox Rift",
  "sv5en": "Temporal Forces", "sv6en": "Twilight Masquerade",
  "sv7en": "Stellar Crown", "sv8en": "Surging Sparks",
  "swsh1": "Sword & Shield", "swsh2": "Rebel Clash",
  "swsh3": "Darkness Ablaze", "swsh3.5": "Champion's Path",
  "swsh4": "Vivid Voltage", "swsh5": "Battle Styles",
  "swsh6": "Chilling Reign", "swsh7": "Evolving Skies",
  "swsh8": "Fusion Strike", "swsh9": "Brilliant Stars",
  "swsh10": "Astral Radiance", "swsh11": "Lost Origin",
  "swsh12": "Silver Tempest", "swsh12.5": "Crown Zenith",
  "sm1": "Sun & Moon", "sm2": "Guardians Rising",
  "sm3": "Burning Shadows", "sm3.5": "Shining Legends",
  "sm5": "Ultra Prism", "sm7": "Celestial Storm",
  "sm8": "Lost Thunder", "sm9": "Team Up",
  "sm10": "Unbroken Bonds", "sm11": "Unified Minds", "sm12": "Cosmic Eclipse",
  "s6": "Eevee Heroes", "s8": "Fusion Arts",
  "s9": "Star Birth", "s11": "Lost Abyss", "s12a": "VSTAR Universe",
};

export function buildCardId(setCode, cardNumber) {
  if (!setCode || !cardNumber) return null;
  const num = cardNumber.replace(/\s/g, "").replace("/", "-");
  return `${setCode.toLowerCase()}/${num}`;
}

export function parseCardIdentity(query) {
  const number = extractCardNumber(query);
  const setCode = extractSetCode(query);
  const rarity = extractRarity(query);
  const name = extractPokemonName(query);
  const cardId = buildCardId(setCode, number);

  return { cardId, name, setCode, number, rarity };
}

export async function getOrCreateCard(query, { source, lang } = {}) {
  const fs = getDb();
  const identity = parseCardIdentity(query);
  if (!identity.cardId) return { ...identity, stored: false };

  if (!fs) return { ...identity, stored: false };

  try {
    const doc = await fs.collection(COLLECTION).doc(identity.cardId).get();
    if (doc.exists) {
      const data = doc.data();
      if (source && !data.sources?.includes(source)) {
        await fs.collection(COLLECTION).doc(identity.cardId).update({
          sources: Firestore.FieldValue.arrayUnion(source),
          searchQueries: Firestore.FieldValue.arrayUnion(query.toLowerCase().trim()),
        });
      }
      return { ...data, stored: true };
    }

    const card = {
      cardId: identity.cardId,
      names: {},
      setCode: identity.setCode,
      number: identity.number,
      rarity: identity.rarity,
      sources: source ? [source] : [],
      searchQueries: [query.toLowerCase().trim()],
      tcgplayerProductId: null,
      psaSpecId: null,
      createdAt: new Date().toISOString(),
    };

    if (identity.name) {
      const key = lang === "jp" ? "jp" : "en";
      card.names[key] = identity.name;
    }

    await fs.collection(COLLECTION).doc(identity.cardId).set(card);
    return { ...card, stored: true };
  } catch {
    return { ...identity, stored: false };
  }
}

export function resolveCardIdToQuery(cardId) {
  const m = cardId.match(/^([a-z0-9.]+)\/([\d]+-[\d]+)$/i);
  if (!m) return cardId;
  const setCode = m[1];
  const number = m[2].replace("-", "/");
  const setName = SET_NAME_MAP[setCode] || "";
  return `${number} ${setName}`.trim();
}

export async function findCardByQuery(query) {
  const fs = getDb();
  if (!fs) return null;

  const identity = parseCardIdentity(query);
  if (identity.cardId) {
    try {
      const doc = await fs.collection(COLLECTION).doc(identity.cardId).get();
      if (doc.exists) return doc.data();
    } catch {}
  }

  try {
    const snap = await fs.collection(COLLECTION)
      .where("searchQueries", "array-contains", query.toLowerCase().trim())
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].data();
  } catch {
    return null;
  }
}

