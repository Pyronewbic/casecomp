import { chromium } from "playwright";

const POKEMON_TCG_API = "https://api.pokemontcg.io/v2";
const POKEBEACH_URL = "https://www.pokebeach.com/";
const POKEMON_NEWS_URL = "https://www.pokemon.com/us/pokemon-news/";

const EVENT_KEYWORDS = [
  "pre-order", "preorder", "release date", "in stock", "drops",
  "restock", "revealed", "announced", "available", "launch",
  "releasing", "coming soon", "live now", "back in stock",
];

function matchesQuery(text, query) {
  const lower = text.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const matched = tokens.filter(t => lower.includes(t));
  return matched.length >= Math.min(2, tokens.length);
}

function hasEventKeyword(text) {
  const lower = text.toLowerCase();
  return EVENT_KEYWORDS.some(kw => lower.includes(kw));
}

function parseDate(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d.getTime())) return str.trim();
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return dateStr; }
}

export async function scanPokemonTCGAPI(query, { log = console.log, limit = 10 } = {}) {
  log("  [api] searching pokemontcg.io...");
  const results = [];

  try {
    const setRes = await fetch(
      `${POKEMON_TCG_API}/sets?q=name:"${encodeURIComponent(query)}*"&orderBy=-releaseDate`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (setRes.ok) {
      const data = await setRes.json();
      for (const set of (data.data || []).slice(0, limit)) {
        results.push({
          date: parseDate(set.releaseDate),
          event: `${set.name} (${set.series}) — official release`,
          source: "PokemonTCG API",
          link: `https://pokemontcg.io/sets/${set.id}`,
        });
      }
    }
  } catch (e) {
    log(`  [api] set search failed: ${e.message}`);
  }

  if (!results.length) {
    try {
      const cardRes = await fetch(
        `${POKEMON_TCG_API}/cards?q=name:"${encodeURIComponent(query)}"&pageSize=5&orderBy=-set.releaseDate`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (cardRes.ok) {
        const data = await cardRes.json();
        const seen = new Set();
        for (const card of (data.data || [])) {
          const setId = card.set?.id;
          if (setId && !seen.has(setId)) {
            seen.add(setId);
            results.push({
              date: parseDate(card.set.releaseDate),
              event: `${card.name} found in ${card.set.name} — set release`,
              source: "PokemonTCG API",
              link: `https://pokemontcg.io/sets/${setId}`,
            });
          }
        }
      }
    } catch (e) {
      log(`  [api] card search failed: ${e.message}`);
    }
  }

  log(`  [api] ${results.length} result(s)`);
  return results;
}

export async function scanPokeBeach(query, browser, { log = console.log, limit = 10 } = {}) {
  const searchUrl = `https://www.pokebeach.com/?s=${encodeURIComponent(query)}`;
  log(`  [pokebeach] searching: ${searchUrl}`);
  const page = await browser.newPage();
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    const articles = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      const links = document.querySelectorAll("a[href*='pokebeach.com/20']");
      for (const a of links) {
        const href = a.href || "";
        const title = a.textContent?.trim() || "";
        if (!title || title.length < 15 || seen.has(href)) continue;
        seen.add(href);
        const container = a.closest("article, li, div");
        const dateEl = container?.querySelector("time, [class*='date']");
        const date = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";
        results.push({ title: title.slice(0, 150), href, date });
      }
      return results;
    });

    const filtered = articles
      .slice(0, limit)
      .map(a => ({
        date: parseDate(a.date),
        event: a.title,
        source: "PokeBeach",
        link: a.href,
      }));

    log(`  [pokebeach] ${filtered.length} result(s)`);
    return filtered;
  } catch (e) {
    log(`  [pokebeach] scrape failed: ${e.message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function scanPokemonDotCom(query, browser, { log = console.log, limit = 10 } = {}) {
  const searchUrl = `https://www.pokemon.com/us/search#Pokemon+TCG+${encodeURIComponent(query)}`;
  log(`  [pokemon.com] searching news...`);
  const page = await browser.newPage();
  try {
    await page.goto(POKEMON_NEWS_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);

    const articles = await page.evaluate((q) => {
      const results = [];
      const seen = new Set();
      const links = document.querySelectorAll("a[href*='pokemon-news']");
      for (const a of links) {
        const href = a.href || "";
        if (seen.has(href)) continue;
        const title = a.textContent?.trim() || "";
        if (!title || title.length < 10) continue;
        seen.add(href);
        const container = a.closest("[class*='card'], article, li, div");
        const dateEl = container?.querySelector("time, [class*='date']");
        const date = dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "";
        results.push({ title: title.slice(0, 150), href, date });
      }
      return results;
    }, query);

    const qLower = query.toLowerCase();
    const tokens = qLower.split(/\s+/).filter(t => t.length > 2);
    const filtered = articles
      .filter(a => {
        const t = a.title.toLowerCase();
        return tokens.some(tok => t.includes(tok)) || t.includes("tcg") || t.includes("release");
      })
      .slice(0, limit)
      .map(a => ({
        date: parseDate(a.date),
        event: a.title,
        source: "Pokemon.com",
        link: a.href,
      }));

    log(`  [pokemon.com] ${filtered.length} result(s) from ${articles.length} articles`);
    return filtered;
  } catch (e) {
    log(`  [pokemon.com] scrape failed: ${e.message}`);
    return [];
  } finally {
    await page.close();
  }
}

export async function scanAll(query, { log = console.log, limit = 10, source } = {}) {
  const apiOnly = source === "api";
  const needsBrowser = !source || source === "pokebeach" || source === "pokemon";

  const apiPromise = (!source || source === "api")
    ? scanPokemonTCGAPI(query, { log, limit })
    : Promise.resolve([]);

  let browser = null;
  let pokebeachPromise = Promise.resolve([]);
  let pokemonPromise = Promise.resolve([]);

  if (needsBrowser) {
    try {
      browser = await chromium.launch({ headless: true });
      if (!source || source === "pokebeach") {
        pokebeachPromise = scanPokeBeach(query, browser, { log, limit });
      }
      if (!source || source === "pokemon") {
        pokemonPromise = scanPokemonDotCom(query, browser, { log, limit });
      }
    } catch (e) {
      log(`  browser launch failed: ${e.message}`);
    }
  }

  const settled = await Promise.allSettled([apiPromise, pokebeachPromise, pokemonPromise]);
  if (browser) await browser.close();

  const results = [];
  const labels = ["PokemonTCG API", "PokeBeach", "Pokemon.com"];
  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === "fulfilled") {
      results.push(...settled[i].value);
    } else {
      log(`  [warn] ${labels[i]} failed: ${settled[i].reason?.message || settled[i].reason}`);
    }
  }

  const seen = new Set();
  const deduped = results.filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  deduped.sort((a, b) => {
    if (a.date === "—" && b.date !== "—") return 1;
    if (b.date === "—" && a.date !== "—") return -1;
    return b.date.localeCompare(a.date);
  });

  return deduped;
}

export function formatScanResults(query, results) {
  const lines = [];
  lines.push(`## Scan: ${query}`);
  lines.push("");
  if (!results.length) {
    lines.push("No events found.");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Date | Event | Source | Link |");
  lines.push("|------|-------|--------|------|");
  for (const r of results) {
    const date = formatDate(r.date);
    const event = r.event.replace(/\|/g, "\\|");
    const link = r.link ? `[${r.source}](${r.link})` : "—";
    lines.push(`| ${date} | ${event} | ${r.source} | ${link} |`);
  }
  lines.push("");
  const sources = [...new Set(results.map(r => r.source))];
  lines.push(`_Scanned ${sources.length} source(s). ${results.length} result(s) found._`);
  return lines.join("\n");
}
