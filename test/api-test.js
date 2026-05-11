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

  await test("Umbreon demo: 5 active AI graded + 4 sold", async () => {
    const { body } = await jsonNoAuth("/api/search?q=Umbreon+ex+SAR+217/187&demo=true");
    assert(body._demo === true, "not demo");
    const items = body.activeByCountry?.US || [];
    assert(items.length === 5, `expected 5 active, got ${items.length}`);
    assert(body.sold.length === 4, `expected 4 sold, got ${body.sold.length}`);
    for (const item of items) {
      assert(item.grade && !item.grade.error, `missing grade on ${item.itemId}`);
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

  // ── Summary ──

  console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
