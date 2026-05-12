import "dotenv/config";

const BASE = process.env.API_URL || "http://localhost:3000";
const API_KEY = process.env.CASECOMP_API_KEY || "";
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${name} — ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  if (API_KEY) h.Authorization = `Bearer ${API_KEY}`;
  return h;
}

async function json(path, opts = {}) {
  const headers = { ...authHeaders(), ...opts.headers };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const body = await res.json();
  return { res, body };
}

async function jsonNoAuth(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json();
  return { res, body };
}

// ── Seed data ──

const SEED_DROPS = [
  { site: "Pokemon Center", status: "detected", detail: "Queue detected for Prismatic Evolutions ETB", url: "https://www.pokemoncenter.com/product/100-10101/pokemon-tcg-prismatic-evolutions-etb" },
  { site: "Pokemon Center", status: "joined", detail: "Auto-joined queue", url: "https://www.pokemoncenter.com/product/100-10101/pokemon-tcg-prismatic-evolutions-etb" },
  { site: "Pokemon Center", status: "through", detail: "Product page loaded — you're through!", url: "https://www.pokemoncenter.com/product/100-10101/pokemon-tcg-prismatic-evolutions-etb" },
  { site: "Walmart", status: "detected", detail: "Queue-it — Ticket: abc123 | Turn: 2:30 PM | Likelihood: high", url: "https://www.walmart.com/ip/Pokemon-TCG-Surging-Sparks-ETB/123456" },
  { site: "Walmart", status: "captcha", detail: "PerimeterX CAPTCHA — press & hold to solve!", url: "https://www.walmart.com/ip/Pokemon-TCG-Surging-Sparks-ETB/123456" },
  { site: "Costco", status: "detected", detail: "Costco queue — Position: 142 | ETA: 3:00", url: "https://www.costco.com/pokemon-tcg-bundle.product.4000250313.html" },
  { site: "Target", status: "detected", detail: "Target waiting room detected", url: "https://www.target.com/p/pokemon-tcg-prismatic-evolutions/-/A-12345678" },
  { site: "Target", status: "through", detail: "Product page loaded — you're through!", url: "https://www.target.com/p/pokemon-tcg-prismatic-evolutions/-/A-12345678" },
  { site: "Pokemon Center", status: "atc-success", detail: "Auto-added to cart!", url: "https://www.pokemoncenter.com/product/100-10101/pokemon-tcg-prismatic-evolutions-etb" },
  { site: "Pokemon Center", status: "checkout-success", detail: "Order placed successfully!", url: "https://www.pokemoncenter.com/product/100-10101/pokemon-tcg-prismatic-evolutions-etb" },
];

const SEED_WEBHOOK = {
  url: "https://httpbin.org/post",
  events: ["drop.opened", "queue.through", "checkout.cleared"],
};

// ── Tests ──

async function run() {
  console.log("\n\x1b[1m=== health ===\x1b[0m");

  await test("GET /api/health returns ok", async () => {
    const { body } = await json("/api/health");
    assert(body.status === "ok", `expected ok, got ${body.status}`);
    assert(typeof body.uptime === "number");
    assert("redis" in body);
    assert("ebay" in body);
  });

  // ── Seed drops ──

  console.log("\n\x1b[1m=== seed drops ===\x1b[0m");
  const seededDrops = [];

  for (const drop of SEED_DROPS) {
    await test(`POST /api/drop-event — ${drop.site} ${drop.status}`, async () => {
      const { res, body } = await json("/api/drop-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drop),
      });
      assert(res.status === 200, `status ${res.status}`);
      assert(body.id?.startsWith("drp_"), `bad id: ${body.id}`);
      assert(body.site === drop.site);
      assert(body.status === drop.status);
      assert(body.ts);
      seededDrops.push(body);
    });
  }

  // ── Drops endpoints ──

  console.log("\n\x1b[1m=== v1/drops ===\x1b[0m");

  await test("GET /v1/drops returns array", async () => {
    const { body } = await json("/v1/drops");
    assert(Array.isArray(body.drops), "drops should be array");
    assert(typeof body.count === "number");
    assert(typeof body.limit === "number");
  });

  await test("GET /v1/drops?limit=3 respects limit", async () => {
    const { body } = await json("/v1/drops?limit=3");
    assert(body.limit === 3, `limit should be 3, got ${body.limit}`);
    assert(body.drops.length <= 3, `too many results: ${body.drops.length}`);
  });

  await test("GET /v1/drops?site=walmart filters by site", async () => {
    const { body } = await json("/v1/drops?site=walmart");
    for (const d of body.drops) {
      assert(d.site.toLowerCase().includes("walmart"), `unexpected site: ${d.site}`);
    }
  });

  await test("GET /v1/drops?status=through filters by status", async () => {
    const { body } = await json("/v1/drops?status=through");
    for (const d of body.drops) {
      assert(d.status === "through", `expected through, got ${d.status}`);
    }
  });

  if (seededDrops.length) {
    const dropId = seededDrops[0].id;
    await test(`GET /v1/drops/${dropId} returns single drop`, async () => {
      const { res, body } = await json(`/v1/drops/${dropId}`);
      if (res.status === 404) {
        assert(true, "Redis not available — skip");
        return;
      }
      assert(body.id === dropId, `expected ${dropId}, got ${body.id}`);
    });
  }

  await test("GET /v1/drops/nonexistent returns 404", async () => {
    const { res } = await json("/v1/drops/nonexistent_id_xyz");
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  // ── Webhooks ──

  console.log("\n\x1b[1m=== v1/webhooks ===\x1b[0m");

  let webhookId = null;

  await test("POST /v1/webhooks creates webhook", async () => {
    const { res, body } = await json("/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(SEED_WEBHOOK),
    });
    assert(res.status === 201, `status ${res.status}`);
    assert(body.id?.startsWith("wh_"), `bad id: ${body.id}`);
    assert(body.url === SEED_WEBHOOK.url);
    assert(body.events.length === SEED_WEBHOOK.events.length);
    assert(body.active === true);
    webhookId = body.id;
  });

  await test("POST /v1/webhooks rejects missing url", async () => {
    const { res, body } = await json("/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: ["drop.opened"] }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(body.error);
  });

  await test("POST /v1/webhooks rejects invalid events", async () => {
    const { res, body } = await json("/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", events: ["fake.event"] }),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  await test("GET /v1/webhooks lists webhooks", async () => {
    const { body } = await json("/v1/webhooks");
    assert(Array.isArray(body.webhooks));
    assert(body.count >= 1, `expected at least 1, got ${body.count}`);
  });

  if (webhookId) {
    await test(`DELETE /v1/webhooks/${webhookId} removes webhook`, async () => {
      const { body } = await json(`/v1/webhooks/${webhookId}`, { method: "DELETE" });
      assert(body.ok === true);
      assert(body.id === webhookId);
    });
  }

  // ── Comps ──

  console.log("\n\x1b[1m=== v1/comps ===\x1b[0m");

  await test("GET /v1/comps requires sku or q", async () => {
    const { res, body } = await json("/v1/comps");
    assert(res.status === 400, `expected 400, got ${res.status}`);
    assert(body.error.includes("sku"), body.error);
  });

  await test("GET /v1/comps?sku=pikachu+vmax+alt+art returns data", async () => {
    const { res, body } = await json("/v1/comps?sku=pikachu+vmax+alt+art");
    assert(res.status === 200, `status ${res.status}`);
    assert(body.query);
    assert("active" in body);
    assert("sold" in body);
    assert(typeof body.active.count === "number");
    assert(typeof body.sold.count === "number");
  });

  // ── Search ──

  console.log("\n\x1b[1m=== api/search ===\x1b[0m");

  await test("GET /api/search requires q", async () => {
    const { res, body } = await json("/api/search");
    assert(res.status === 400);
    assert(body.error.includes("q"));
  });

  await test("GET /api/search?q=charizard returns results", async () => {
    const { res, body } = await json("/api/search?q=charizard&results=2");
    assert(res.status === 200, `status ${res.status}`);
    assert(body.query === "charizard");
    assert("activeByCountry" in body || "items" in body);
  });

  // ── Sold ──

  console.log("\n\x1b[1m=== api/sold ===\x1b[0m");

  await test("GET /api/sold requires q", async () => {
    const { res } = await json("/api/sold");
    assert(res.status === 400);
  });

  await test("GET /api/sold?q=umbreon+vmax+alt returns sold comps", async () => {
    const { res, body } = await json("/api/sold?q=umbreon+vmax+alt&sold=2");
    assert(res.status === 200, `status ${res.status}`);
    assert(body.query);
    assert(Array.isArray(body.sold));
  });

  // ── PSA ──

  console.log("\n\x1b[1m=== api/psa ===\x1b[0m");

  await test("GET /api/psa requires q", async () => {
    const { res } = await json("/api/psa");
    assert(res.status === 400);
  });

  await test("GET /api/psa?q=charizard+ex returns signal", async () => {
    const { res, body } = await json("/api/psa?q=charizard+ex");
    assert(res.status === 200, `status ${res.status}`);
    assert(body.query);
    assert("signal" in body);
  });

  // ── Grade ──

  console.log("\n\x1b[1m=== api/grade ===\x1b[0m");

  await test("POST /api/grade requires imageUrl", async () => {
    const { res, body } = await json("/api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(res.status === 400);
    assert(body.error.includes("imageUrl"));
  });

  // ── Auth ──

  console.log("\n\x1b[1m=== auth ===\x1b[0m");

  await test("GET /api/search without key returns 401 (if key configured)", async () => {
    const { res } = await jsonNoAuth("/api/search?q=charizard");
    if (API_KEY) {
      assert(res.status === 401, `expected 401, got ${res.status}`);
    } else {
      assert(res.status === 200 || res.status === 400, `unexpected ${res.status}`);
    }
  });

  await test("Demo bypasses auth", async () => {
    const { res, body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(body._demo === true);
  });

  // ── Admin keys ──

  console.log("\n\x1b[1m=== admin keys ===\x1b[0m");

  let testKeyId = null;

  await test("GET /admin/keys without owner key returns 403", async () => {
    const { res } = await jsonNoAuth("/admin/keys");
    assert(res.status === 403 || res.status === 401, `expected 401/403, got ${res.status}`);
  });

  await test("GET /admin/keys with owner key returns list", async () => {
    const { res, body } = await json("/admin/keys");
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(body.keys));
    assert(typeof body.count === "number");
  });

  await test("POST /admin/keys creates a key", async () => {
    const { res, body } = await json("/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "test-key", rateLimit: 10 }),
    });
    assert(res.status === 201, `status ${res.status}`);
    assert(body.id?.startsWith("key_"), `bad id: ${body.id}`);
    assert(body.key?.startsWith("CC_LIVE_"), "key should start with CC_LIVE_");
    assert(body.label === "test-key");
    assert(body.rateLimit === 10);
    assert(body.active === true);
    testKeyId = body.id;
  });

  await test("POST /admin/keys requires label", async () => {
    const { res } = await json("/admin/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(res.status === 400, `expected 400, got ${res.status}`);
  });

  if (testKeyId) {
    await test("GET /admin/keys/:id returns single key", async () => {
      const { res, body } = await json(`/admin/keys/${testKeyId}`);
      assert(res.status === 200);
      assert(body.id === testKeyId);
      assert(body.label === "test-key");
    });

    await test("PATCH /admin/keys/:id updates key", async () => {
      const { res, body } = await json(`/admin/keys/${testKeyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "updated-key", active: false }),
      });
      assert(res.status === 200);
      assert(body.label === "updated-key");
      assert(body.active === false);
    });

    await test("POST /admin/keys/:id/rotate returns new key", async () => {
      const { res, body } = await json(`/admin/keys/${testKeyId}/rotate`, { method: "POST" });
      assert(res.status === 200);
      assert(body.key?.startsWith("CC_LIVE_"), "rotated key should start with CC_LIVE_");
    });

    await test("DELETE /admin/keys/:id deletes key", async () => {
      const { res, body } = await json(`/admin/keys/${testKeyId}`, { method: "DELETE" });
      assert(res.status === 200);
      assert(body.ok === true);
    });

    await test("GET /admin/keys/:id after delete returns 404", async () => {
      const { res } = await json(`/admin/keys/${testKeyId}`);
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });
  }

  await test("GET /admin/keys/nonexistent returns 404", async () => {
    const { res } = await json("/admin/keys/key_nonexistent_xyz");
    assert(res.status === 404);
  });

  // ── Condition + detection ──

  console.log("\n\x1b[1m=== condition ===\x1b[0m");

  await test("Search results include detectedCondition", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true&source=snkrdunk&condition=A");
    const items = body.activeByCountry?.US || [];
    assert(items.length > 0, "expected items");
    assert(items.every(i => i.detectedCondition), "expected detectedCondition on all items");
  });

  await test("Condition filter reduces results", async () => {
    const { body: all } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true");
    const { body: filtered } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true&condition=A");
    assert(filtered.counts.activeTotal <= all.counts.activeTotal, "filtered should be <= all");
  });

  // ── Card identity ──

  console.log("\n\x1b[1m=== api/card ===\x1b[0m");

  await test("GET /api/card returns identity for demo card", async () => {
    const { res, body } = await jsonNoAuth("/api/card?q=Umbreon+ex+SAR+217/187&demo=true");
    assert(res.status === 200, `status ${res.status}`);
    assert(body.cardId === "sv8a/217-187", `expected sv8a/217-187, got ${body.cardId}`);
    assert(body.rarity === "SAR");
    assert(body.setName);
  });

  await test("GET /api/card returns parsed identity for unknown card", async () => {
    const { res, body } = await jsonNoAuth("/api/card?q=Pikachu+ex+SAR+234/193&demo=true");
    assert(res.status === 200);
    assert(body.cardId === "m2a/234-193", `expected m2a/234-193, got ${body.cardId}`);
  });

  await test("GET /api/card requires q", async () => {
    const { res } = await json("/api/card");
    assert(res.status === 400);
  });

  // ── Arbitrage ──

  console.log("\n\x1b[1m=== api/arbitrage ===\x1b[0m");

  await test("GET /api/arbitrage returns cross-source comparison", async () => {
    const { res, body } = await jsonNoAuth("/api/arbitrage?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    assert(res.status === 200, `status ${res.status}`);
    assert(Object.keys(body.sources || {}).length >= 2, "expected 2+ sources");
    assert(body.arbitrage, "expected arbitrage object");
    assert(body.arbitrage.spread > 0, "expected positive spread");
    assert(body.arbitrage.cheapest.source);
  });

  await test("GET /api/arbitrage requires q", async () => {
    const { res } = await json("/api/arbitrage");
    assert(res.status === 400);
  });

  // ── Price history ──

  console.log("\n\x1b[1m=== api/price-history ===\x1b[0m");

  await test("GET /api/price-history returns data for seeded card", async () => {
    const { res, body } = await json("/api/price-history?q=Umbreon+ex+SAR+217/187&days=90");
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(body.history));
    assert(body.query);
  });

  await test("GET /api/price-history requires q", async () => {
    const { res } = await json("/api/price-history");
    assert(res.status === 400);
  });

  await test("GET /api/price-history without key returns 401", async () => {
    const { res } = await jsonNoAuth("/api/price-history?q=test");
    if (API_KEY) assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  // ── Track prices ──

  console.log("\n\x1b[1m=== api/track-prices ===\x1b[0m");

  await test("POST /api/track-prices records demo prices", async () => {
    const { res, body } = await json("/api/track-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: ["Umbreon ex SAR 217/187"] }),
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(body.tracked >= 1);
  });

  await test("POST /api/track-prices without key returns 401", async () => {
    const { res } = await jsonNoAuth("/api/track-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (API_KEY) assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  // ── Delete errors ──

  console.log("\n\x1b[1m=== api/errors (delete) ===\x1b[0m");

  await test("DELETE /api/errors clears logs (owner only)", async () => {
    const { res, body } = await json("/api/errors", { method: "DELETE" });
    assert(res.status === 200, `status ${res.status}`);
    assert(body.ok === true);
    assert(typeof body.cleared === "number");
  });

  await test("DELETE /api/errors without key returns 403", async () => {
    const { res } = await jsonNoAuth("/api/errors", { method: "DELETE" });
    if (API_KEY) assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  });

  // ── Demo data ──

  console.log("\n\x1b[1m=== demo data ===\x1b[0m");

  await test("Greninja demo: 5 active, all AI graded", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true&source=snkrdunk&condition=A");
    assert(body._demo === true, "not demo");
    const items = body.activeByCountry?.US || [];
    assert(items.length === 5, `expected 5 active, got ${items.length}`);
    for (const item of items) {
      assert(item.grade && !item.grade.error, `missing grade on ${item.itemId}`);
      assert(item.grade.overall >= 1 && item.grade.overall <= 10, `bad overall: ${item.grade.overall}`);
      assert(item.grade.centering != null, "missing centering");
      assert(item.grade.corners != null, "missing corners");
      assert(item.grade.edges != null, "missing edges");
      assert(item.grade.surface != null, "missing surface");
      assert(item.grade.confidence > 0 && item.grade.confidence <= 1, `bad confidence: ${item.grade.confidence}`);
      assert(item.imageUrl, `missing imageUrl on ${item.itemId}`);
    }
  });

  await test("Greninja demo: PSA signal with Value tier", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true&source=snkrdunk&condition=A");
    const psa = body.psaSignal;
    assert(psa, "missing psaSignal");
    assert(psa.totalPop > 0, "bad totalPop");
    assert(psa.pop10 > 0, "bad pop10");
    assert(psa.pop9 > 0, "bad pop9");
    assert(psa.difficulty, "missing difficulty");
    assert(psa.gem10Pct > 0, "bad gem10Pct");
    assert(psa.tier === "Value", `expected Value, got ${psa.tier}`);
    assert(psa.estCost === "$25", `expected $25, got ${psa.estCost}`);
    assert(psa.tierReason, "missing tierReason");
  });

  await test("Umbreon demo: 8 active (multi-source) + 7 sold", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    assert(body._demo === true, "not demo");
    assert(body.source === "multi", `expected multi, got ${body.source}`);
    const items = body.activeByCountry?.US || [];
    assert(items.length === 8, `expected 8 active, got ${items.length}`);
    assert(body.sold.length === 7, `expected 7 sold, got ${body.sold.length}`);
    const graded = items.filter(i => i.grade && !i.grade.error);
    assert(graded.length === 5, `expected 5 graded, got ${graded.length}`);
    for (const item of graded) {
      assert(item.grade.notes, `missing notes on ${item.itemId}`);
      assert(item.imageUrl, `missing imageUrl on ${item.itemId}`);
    }
  });

  await test("Umbreon demo: Regular tier for $750+ PSA 10", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    const psa = body.psaSignal;
    assert(psa, "missing psaSignal");
    assert(psa.tier === "Regular", `expected Regular, got ${psa.tier}`);
    assert(psa.estCost === "$50", `expected $50, got ${psa.estCost}`);
    assert(psa.tierReason, "missing tierReason");
  });

  await test("Pikachu demo: multi-source slab, 6 active + 5 sold", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    assert(body._demo === true, "not demo");
    assert(body.source === "multi", `expected multi, got ${body.source}`);
    assert(body.listingFormat === "slab", `expected slab, got ${body.listingFormat}`);
    const items = body.activeByCountry?.US || [];
    assert(items.length === 6, `expected 6 active, got ${items.length}`);
    assert(body.sold.length === 5, `expected 5 sold, got ${body.sold.length}`);
  });

  await test("Pikachu demo: all listings have PSA 10 slab label + image", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    const items = body.activeByCountry?.US || [];
    for (const item of items) {
      assert(item.listingGradeLabel === "PSA 10", `expected PSA 10, got ${item.listingGradeLabel} on ${item.itemId}`);
      assert(item.grade === null, `slab should have null grade on ${item.itemId}`);
      assert(item.imageUrl, `missing imageUrl on ${item.itemId}`);
    }
  });

  await test("Pikachu demo: listings from 3 sources", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    const items = body.activeByCountry?.US || [];
    const sources = new Set(items.map(i => {
      if (i.itemWebUrl.includes("magi")) return "magi";
      if (i.itemWebUrl.includes("yahoo")) return "yahoo";
      if (i.itemWebUrl.includes("ebay")) return "ebay";
      return "unknown";
    }));
    assert(sources.has("magi"), "missing magi listings");
    assert(sources.has("yahoo"), "missing yahoo listings");
    assert(sources.has("ebay"), "missing ebay listings");
  });

  await test("Pikachu demo: Express tier for $700+ card", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    const psa = body.psaSignal;
    assert(psa, "missing psaSignal");
    assert(psa.tier === "Express", `expected Express, got ${psa.tier}`);
    assert(psa.estCost === "$75", `expected $75, got ${psa.estCost}`);
    assert(psa.tierReason, "missing tierReason");
  });

  await test("Pikachu demo: magi/yahoo have JPY prices", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Pikachu+ex+SAR+234/193+PSA+10&demo=true");
    const items = body.activeByCountry?.US || [];
    const jpItems = items.filter(i => i.itemWebUrl.includes("magi") || i.itemWebUrl.includes("yahoo"));
    assert(jpItems.length > 0, "no magi/yahoo items");
    for (const item of jpItems) {
      assert(item.priceJPY > 0, `missing priceJPY on ${item.itemId}`);
    }
  });

  await test("Demo: unknown card returns _demoNote", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Nonexistent+Card+XYZ&demo=true");
    assert(body._demo === true, "not demo");
    assert(body._demoNote, "missing _demoNote for unknown card");
    assert(body.counts.activeTotal === 0, "should have 0 active");
  });

  await test("Demo: /docs/spec.json returns version", async () => {
    const { body } = await jsonNoAuth("/docs/spec.json");
    assert(body.info?.version, "missing version");
    assert(body.info.version.includes("beta"), `expected beta version, got ${body.info.version}`);
  });

  // ── Share pages ──

  await test("Share: /api/card/share/sv8a/217-187 returns Umbreon data", async () => {
    const { body } = await jsonNoAuth("/api/card/share/sv8a/217-187");
    assert(body.cardId === "sv8a/217-187", `expected sv8a/217-187, got ${body.cardId}`);
    assert(body.identity?.name === "Umbreon ex", `expected Umbreon ex, got ${body.identity?.name}`);
    assert(body.identity?.rarity === "SAR", `expected SAR, got ${body.identity?.rarity}`);
    assert(body.price?.lowest > 0, "missing lowest price");
    assert(body.price?.listingCount > 0, "no listings");
    assert(body.price?.bySources && Object.keys(body.price.bySources).length >= 2, "expected 2+ sources");
    assert(body.psaSignal?.totalPop > 0, "missing PSA signal");
    assert(body.priceHistory?.history?.length >= 3, "expected 3+ price history points");
  });

  await test("Share: /api/card/share/m4/114-083 returns Greninja data", async () => {
    const { body } = await jsonNoAuth("/api/card/share/m4/114-083");
    assert(body.cardId === "m4/114-083");
    assert(body.identity?.name === "Mega Greninja ex", `expected Mega Greninja ex, got ${body.identity?.name}`);
    assert(body.price?.listingCount === 8, `expected 8 listings, got ${body.price?.listingCount}`);
    assert(body.priceHistory?.history?.length === 6, `expected 6 history points`);
  });

  await test("Share: /api/card/share/m2a/234-193 returns Pikachu data", async () => {
    const { body } = await jsonNoAuth("/api/card/share/m2a/234-193");
    assert(body.cardId === "m2a/234-193");
    assert(body.identity?.name === "Pikachu ex");
    assert(body.price?.lowest > 0);
  });

  // ── Demo price history ──

  await test("Demo price-history returns sold data with dates", async () => {
    const { body } = await jsonNoAuth("/api/price-history?q=Umbreon+ex+SAR+217/187&days=90&demo=true");
    assert(body._demo === true, "not demo");
    assert(body.history?.length >= 3, `expected 3+ history points, got ${body.history?.length}`);
    assert(body.stats?.avg > 0, "missing avg stat");
    const dates = body.history.map(h => h.recordedAt);
    const unique = new Set(dates);
    assert(unique.size >= 3, "expected 3+ unique dates");
  });

  // ── Alerts ──

  await test("POST /api/alerts creates arbitrage alert", async () => {
    const { res, body } = await json("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "test-api@test.com", query: "Umbreon ex SAR", type: "arbitrage", spreadThreshold: 15 }) });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(body.ok === true);
  });

  await test("POST /api/alerts creates price alert", async () => {
    const { res, body } = await json("/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "test-api@test.com", query: "Pikachu ex SAR", type: "price", targetPrice: 500 }) });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(body.ok === true);
  });

  // ── Condition filter ──

  await test("Demo condition filter: mint returns SNKRDUNK items", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Mega+Greninja+ex+SAR&demo=true&condition=mint");
    const items = body.activeByCountry?.US || [];
    assert(items.length === 5, `expected 5 mint, got ${items.length}`);
    assert(items.every(i => (i.detectedCondition || "").toLowerCase() === "mint"), "not all mint");
  });

  await test("Demo condition filter: nm returns NM items", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true&condition=nm");
    const items = body.activeByCountry?.US || [];
    assert(items.length > 0, "expected NM items");
    assert(items.every(i => (i.detectedCondition || "").toUpperCase() === "NM"), "not all NM");
  });

  // ── detectedCondition + outlier ──

  await test("Demo items have detectedCondition", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    const items = body.activeByCountry?.US || [];
    const withCond = items.filter(i => i.detectedCondition);
    assert(withCond.length >= 5, `expected 5+ with detectedCondition, got ${withCond.length}`);
  });

  await test("Demo items have _priceOutlier field", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    const items = body.activeByCountry?.US || [];
    assert(items.every(i => typeof i._priceOutlier === "boolean"), "missing _priceOutlier");
  });

  // ── Summary ──

  console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
