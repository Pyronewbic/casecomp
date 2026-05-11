import { chromium } from "playwright";
import { spawn } from "child_process";

const PORT = 3099;
const BASE = `http://localhost:${PORT}`;
let server;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn("node", ["api.js"], {
      env: { ...process.env, API_PORT: PORT, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) resolve();
    });
    server.stderr.on("data", (d) => {
      const msg = d.toString();
      if (!msg.includes("warning") && !msg.includes("ExperimentalWarning")) process.stderr.write(d);
    });
    setTimeout(() => reject(new Error("Server start timeout")), 15000);
  });
}

async function run() {
  console.log("Starting API server on :" + PORT);
  await startServer();

  const browser = await chromium.launch();

  try {
    // --- Desktop viewport ---
    console.log("\n[Desktop]");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(BASE);

    // Header
    console.log("Header:");
    assert(await page.locator("header").isVisible(), "header visible");
    const headerStyle = await page.locator("header").evaluate(el => getComputedStyle(el).position);
    assert(headerStyle === "sticky", "header is sticky");
    assert(await page.locator(".beta-badge").isVisible(), "beta badge visible");
    assert(await page.locator(".logo").isVisible(), "logo visible");

    // Search bar
    console.log("Search:");
    assert(await page.locator("#search-input").isVisible(), "search input visible");
    assert(await page.locator("#search-btn").isVisible(), "search button visible");
    const stickyEl = await page.locator(".search-sticky");
    assert(await stickyEl.count() > 0, "search sticky wrapper exists");

    // Hint pills
    console.log("Hints:");
    const hints = page.locator(".hint");
    assert(await hints.count() === 3, "3 sample hint pills");
    const hintRadius = await hints.first().evaluate(el => getComputedStyle(el).borderRadius);
    assert(hintRadius === "9999px", "hint pills are fully rounded");

    // Feature cards
    console.log("Features:");
    const features = page.locator(".feature");
    assert(await features.count() === 3, "3 feature cards");

    // Click first hint (Pikachu PSA 10)
    console.log("Sample search:");
    await hints.first().click();
    await page.waitForSelector(".listing-card", { timeout: 10000 });

    const cards = page.locator(".listing-card");
    assert(await cards.count() > 0, "listing cards rendered");

    // Results header
    assert(await page.locator(".demo-badge").isVisible(), "sample data badge visible");

    // Detail panel
    console.log("Detail panel:");
    assert(await page.locator(".detail-panel").isVisible(), "detail panel visible");
    assert(await page.locator(".detail-title").isVisible(), "detail title visible");
    assert(await page.locator(".detail-summary").isVisible(), "price summary visible");

    // Tabs
    const tabs = page.locator(".detail-tab");
    assert(await tabs.count() >= 1, "detail tabs exist");
    const pricesTab = page.locator('.detail-tab[data-dtab="prices"]');
    assert(await pricesTab.count() === 1, "Prices tab exists");
    const tabFont = await pricesTab.evaluate(el => getComputedStyle(el).fontFamily);
    assert(tabFont.includes("JetBrains Mono"), "tabs use JetBrains Mono");

    // PSA inline stats (Pikachu PSA 10 has PSA signal)
    await pricesTab.click();
    const psaInline = page.locator(".psa-inline");
    if (await psaInline.count() > 0) {
      console.log("PSA inline:");
      assert(await psaInline.isVisible(), "PSA inline stats visible in Prices tab");
      const statCells = page.locator(".psa-inline-stat");
      assert(await statCells.count() === 4, "4 PSA stat cells (gem/pop/difficulty/tier)");
      const gemBar = page.locator(".gem-bar-track");
      assert(await gemBar.count() > 0, "gem progress bar exists");
    }

    // Arbitrage
    const arbContainer = page.locator("#arbitrage-container");
    await page.waitForTimeout(1500);
    if (await arbContainer.isVisible()) {
      console.log("Arbitrage:");
      const arbSources = page.locator(".arb-source");
      assert(await arbSources.count() >= 2, "at least 2 arbitrage sources");
      const cheapest = page.locator(".arb-cheapest");
      assert(await cheapest.count() === 1, "cheapest source highlighted");
    }

    // Price chart
    const chartContainer = page.locator("#price-chart-container");
    if (await chartContainer.isVisible()) {
      console.log("Price chart:");
      assert(await page.locator("#price-chart").isVisible(), "chart canvas visible");
      assert(await page.locator("#price-chart-stats").isVisible(), "chart stats visible");
    }

    // Source filters (multi-source search)
    const sourceFilters = page.locator(".source-filter");
    if (await sourceFilters.count() > 0) {
      console.log("Source filters:");
      assert(await sourceFilters.count() >= 2, "source filter pills rendered");
    }

    // Card identity
    const cardId = page.locator("#card-identity");
    await page.waitForTimeout(1000);
    if (await cardId.isVisible()) {
      console.log("Card identity:");
      assert(await page.locator(".card-id-badge").isVisible(), "card ID badge visible");
    }

    // View on source link
    const viewLink = page.locator(".detail-actions a");
    if (await viewLink.count() > 0) {
      const href = await viewLink.getAttribute("href");
      assert(href && href.startsWith("http"), "view link has valid URL");
    }

    // Click second hint (Greninja — has AI grade)
    console.log("Grade tab:");
    await page.locator('.hint[data-q="Mega Greninja ex SAR"]').click();
    await page.waitForSelector(".listing-card", { timeout: 10000 });

    const gradeTab = page.locator('.detail-tab[data-dtab="grade"]');
    if (await gradeTab.count() > 0) {
      await gradeTab.click();
      assert(await page.locator(".detail-grade").isVisible(), "grade breakdown visible");
      const gradeBars = page.locator(".grade-bar-item");
      assert(await gradeBars.count() === 4, "4 subgrade bars (centering/corners/edges/surface)");
      assert(await page.locator(".grade-bar-lowest").count() === 1, "lowest subgrade highlighted");
    }

    // Slab badge (check Pikachu slabs have GRADED badge)
    console.log("Slab badge:");
    await hints.first().click();
    await page.waitForSelector(".listing-card", { timeout: 10000 });
    const gradedBadge = page.locator(".graded-badge");
    if (await gradedBadge.count() > 0) {
      assert(await gradedBadge.first().isVisible(), "GRADED badge visible for slab listing");
    }

    // --- Mobile viewport ---
    console.log("\n[Mobile]");
    const mobile = await browser.newPage({ viewport: { width: 375, height: 667 } });
    await mobile.goto(BASE);

    assert(await mobile.locator("header").isVisible(), "header visible on mobile");
    assert(await mobile.locator("#search-input").isVisible(), "search input visible on mobile");

    const bodyWidth = await mobile.evaluate(() => document.body.scrollWidth);
    assert(bodyWidth <= 375, "no horizontal overflow on mobile");

    await mobile.locator(".hint").first().click();
    await mobile.waitForSelector(".listing-card", { timeout: 10000 });
    assert(await mobile.locator(".listing-card").count() > 0, "listings render on mobile");
    assert(await mobile.locator(".detail-panel").isVisible(), "detail panel visible on mobile");

    await mobile.close();
    await page.close();

    // --- Static assets ---
    console.log("\n[Static assets]");
    const page2 = await browser.newPage();
    for (const [path, type] of [
      ["/", "text/html"],
      ["/style.css", "text/css"],
      ["/app.js", "application/javascript"],
    ]) {
      const res = await page2.goto(BASE + path);
      assert(res.status() === 200, `${path} returns 200`);
      const ct = res.headers()["content-type"] || "";
      assert(ct.includes(type), `${path} content-type includes ${type}`);
    }
    await page2.close();

  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(e => {
  console.error(e);
  if (server) server.kill();
  process.exit(1);
});
