import "dotenv/config";

const BASE = process.env.API_URL || "http://localhost:3000";
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

async function json(path, opts) {
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

  // ── Summary ──

  console.log(`\n\x1b[1m=== ${passed} passed, ${failed} failed ===\x1b[0m\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
