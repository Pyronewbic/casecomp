export const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Casecomp API",
    version: "1.2.0",
    description: "Pokemon TCG card research and drop intelligence API. Search listings across eBay, SNKRDUNK, magi.camp, and Yahoo Auctions JP. AI pre-grading, PSA population signals, and real-time drop event tracking with webhooks.\n\n**Hosted API:** `api.casecomp.xyz` — [Get API key](https://casecomp.xyz/developers)\n\n**Self-hosted:** `yarn api` on port 3000",
    license: { name: "MIT + Commons Clause", url: "https://github.com/Pyronewbic/casecomp/blob/main/LICENSE" },
    contact: { name: "Casecomp", url: "https://casecomp.xyz" },
  },
  servers: [
    { url: "https://api.casecomp.xyz", description: "Hosted" },
    { url: "http://localhost:3000", description: "Local" },
  ],
  paths: {
    "/api/search": {
      get: {
        summary: "Search card listings",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Card name" },
          { name: "source", in: "query", schema: { type: "string", enum: ["ebay", "snkrdunk", "magi", "yahoo"], default: "ebay" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["raw", "slab"], default: "raw" } },
          { name: "countries", in: "query", schema: { type: "string", default: "US,IN" }, description: "Comma-separated ISO codes" },
          { name: "lang", in: "query", schema: { type: "string", default: "any" } },
          { name: "results", in: "query", schema: { type: "integer", default: 5 } },
          { name: "sold", in: "query", schema: { type: "integer", default: 5 } },
          { name: "slab_provider", in: "query", schema: { type: "string" } },
          { name: "slab_grade", in: "query", schema: { type: "string" } },
          { name: "condition", in: "query", schema: { type: "string", enum: ["A", "B", "C", "D"] }, description: "SNKRDUNK condition filter" },
          { name: "grade", in: "query", schema: { type: "boolean", default: false }, description: "Run AI pre-grading on listings" },
        ],
        responses: {
          200: { description: "Search results", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResult" } } } },
          400: { description: "Missing required parameter", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/sold": {
      get: {
        summary: "Recent sold comps",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "source", in: "query", schema: { type: "string", enum: ["ebay", "snkrdunk", "magi", "yahoo"], default: "ebay" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["raw", "slab"], default: "raw" } },
          { name: "lang", in: "query", schema: { type: "string", default: "any" } },
          { name: "sold", in: "query", schema: { type: "integer", default: 5 } },
        ],
        responses: {
          200: { description: "Sold listings", content: { "application/json": { schema: { $ref: "#/components/schemas/SoldResult" } } } },
        },
      },
    },
    "/api/psa": {
      get: {
        summary: "PSA grading signal",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: { description: "PSA population signal", content: { "application/json": { schema: { $ref: "#/components/schemas/PsaSignal" } } } },
        },
      },
    },
    "/api/grade": {
      post: {
        summary: "AI pre-grade card image",
        description: "Grades a card from image URL(s) and stores result for training data",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/GradeRequest" } } },
        },
        responses: {
          200: { description: "Grade result", content: { "application/json": { schema: { $ref: "#/components/schemas/GradeResult" } } } },
        },
      },
    },
    "/api/grades": {
      get: {
        summary: "Export stored grades (training data)",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Filter by card name" },
          { name: "source", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
        ],
        responses: {
          200: { description: "Array of grade records", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/GradeRecord" } } } } },
        },
      },
    },
    "/api/sets": {
      get: {
        summary: "List all card sets",
        description: "Returns all Pokemon TCG sets from the card database, grouped by era.",
        parameters: [
          { name: "era", in: "query", schema: { type: "string" }, description: "Filter by era (e.g. 'Scarlet & Violet', 'Sword & Shield')" },
        ],
        responses: {
          200: { description: "Set list", content: { "application/json": { schema: { type: "object", properties: { sets: { type: "array", items: { type: "object", properties: { setCode: { type: "string" }, name: { type: "string" }, era: { type: "string" }, totalCards: { type: "integer" }, imageUrl: { type: "string", nullable: true } } } }, count: { type: "integer" } } } } } },
        },
      },
    },
    "/api/sets/{setCode}": {
      get: {
        summary: "Get cards in a set",
        description: "Returns all cards in a specific set, sorted by card number.",
        parameters: [
          { name: "setCode", in: "path", required: true, schema: { type: "string" }, description: "Set code (e.g. sv8a, swsh7)" },
        ],
        responses: {
          200: { description: "Set with cards", content: { "application/json": { schema: { type: "object", properties: { setCode: { type: "string" }, name: { type: "string" }, era: { type: "string" }, totalCards: { type: "integer" }, cards: { type: "array", items: { type: "object", properties: { cardId: { type: "string" }, name: { type: "string" }, nameJa: { type: "string", nullable: true }, localId: { type: "string" }, imageUrl: { type: "string", nullable: true } } } } } } } } },
          404: { description: "Set not found" },
        },
      },
    },
    "/api/health": {
      get: {
        summary: "Health check",
        responses: {
          200: { description: "Service status", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthCheck" } } } },
        },
      },
    },
    "/v1/drops": {
      get: {
        tags: ["Drop Intelligence"],
        summary: "List recent drop events",
        description: "Returns drop events from all monitored sites. Hosted API aggregates across all extension users; self-hosted only shows your own drops.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 }, description: "Max results" },
          { name: "site", in: "query", schema: { type: "string" }, description: "Filter by site name (e.g. 'pokemon', 'walmart')" },
          { name: "status", in: "query", schema: { type: "string", enum: ["detected", "joined", "waiting", "through", "captcha", "atc-success", "atc-failed"] }, description: "Filter by queue status" },
        ],
        responses: {
          200: { description: "Drop events", content: { "application/json": { schema: { type: "object", properties: { drops: { type: "array", items: { $ref: "#/components/schemas/Drop" } }, count: { type: "integer" }, limit: { type: "integer" } } } } } },
          401: { description: "Invalid or missing API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/drops/{id}": {
      get: {
        tags: ["Drop Intelligence"],
        summary: "Get single drop event",
        description: "Retrieve a specific drop event with full queue metrics and timing data.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Drop ID (e.g. drp_8H2K)" },
        ],
        responses: {
          200: { description: "Drop details", content: { "application/json": { schema: { $ref: "#/components/schemas/Drop" } } } },
          404: { description: "Drop not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/comps": {
      get: {
        tags: ["Drop Intelligence"],
        summary: "Price comparisons",
        description: "Sold and listed prices from eBay, magi.camp, SNKRDUNK, and Yahoo Auctions JP. Combines active listings and recent sold comps in one call.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "sku", in: "query", schema: { type: "string" }, description: "Product SKU or card name (alias: q)" },
          { name: "q", in: "query", schema: { type: "string" }, description: "Card name (alias for sku)" },
          { name: "source", in: "query", schema: { type: "string", enum: ["ebay", "snkrdunk", "magi", "yahoo"], default: "ebay" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["raw", "slab"], default: "raw" } },
          { name: "lang", in: "query", schema: { type: "string", default: "any" } },
          { name: "countries", in: "query", schema: { type: "string", default: "US,IN" } },
          { name: "results", in: "query", schema: { type: "integer", default: 5 } },
          { name: "sold", in: "query", schema: { type: "integer", default: 5 } },
          { name: "condition", in: "query", schema: { type: "string", enum: ["A", "B", "C", "D"] }, description: "SNKRDUNK condition" },
        ],
        responses: {
          200: { description: "Price comps", content: { "application/json": { schema: { $ref: "#/components/schemas/CompsResult" } } } },
          400: { description: "Missing sku or q", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List registered webhooks",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Webhooks list", content: { "application/json": { schema: { type: "object", properties: { webhooks: { type: "array", items: { $ref: "#/components/schemas/Webhook" } }, count: { type: "integer" } } } } } },
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Register a webhook",
        description: "Subscribe to drop and queue events. Your endpoint receives POST requests with event data.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookRequest" } } },
        },
        responses: {
          201: { description: "Webhook created", content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
          400: { description: "Invalid request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/webhooks/{id}": {
      delete: {
        tags: ["Webhooks"],
        summary: "Remove a webhook",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Webhook ID" },
        ],
        responses: {
          200: { description: "Webhook removed", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "string" } } } } } },
        },
      },
    },
    "/api/portfolio": {
      get: {
        tags: ["Portfolio"],
        summary: "Get portfolio cards with current values",
        description: "Returns all cards in the user's portfolio enriched with current market prices and ROI. Use ?demo=true for sample data.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "demo", in: "query", schema: { type: "string", enum: ["true"] }, description: "Use sample portfolio data" },
        ],
        responses: {
          200: { description: "Portfolio with cards and stats", content: { "application/json": { schema: { $ref: "#/components/schemas/PortfolioResponse" } } } },
          401: { description: "Invalid or missing API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      post: {
        tags: ["Portfolio"],
        summary: "Add a card to portfolio",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PortfolioCardRequest" } } },
        },
        responses: {
          201: { description: "Card added", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, card: { $ref: "#/components/schemas/PortfolioCard" } } } } } },
          400: { description: "Invalid cardId format", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
    "/api/portfolio/set/{setCode}": {
      get: {
        tags: ["Portfolio"],
        summary: "Collection progress for a set",
        description: "Returns which cards in a set are owned in the user's portfolio.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "setCode", in: "path", required: true, schema: { type: "string" }, description: "Set code (e.g. sv8a, swsh7)" },
          { name: "demo", in: "query", schema: { type: "boolean" }, description: "Use sample data" },
        ],
        responses: {
          200: { description: "Collection progress", content: { "application/json": { schema: { type: "object", properties: { setCode: { type: "string" }, ownedCardIds: { type: "array", items: { type: "string" } }, ownedCount: { type: "integer" }, totalCards: { type: "integer" } } } } } },
          404: { description: "Set not found" },
        },
      },
    },
    "/api/portfolio/summary": {
      get: {
        tags: ["Portfolio"],
        summary: "Portfolio summary stats",
        description: "Total cards, cost, current value, ROI, best/worst performers.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "demo", in: "query", schema: { type: "string", enum: ["true"] }, description: "Use sample portfolio data" },
        ],
        responses: {
          200: { description: "Portfolio summary", content: { "application/json": { schema: { $ref: "#/components/schemas/PortfolioSummary" } } } },
        },
      },
    },
    "/api/portfolio/{cardId}": {
      delete: {
        tags: ["Portfolio"],
        summary: "Remove a card from portfolio",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cardId", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded card ID (e.g. sv8a%2F217-187)" },
        ],
        responses: {
          200: { description: "Card removed", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, cardId: { type: "string" } } } } } },
          404: { description: "Card not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      patch: {
        tags: ["Portfolio"],
        summary: "Update a portfolio card",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cardId", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded card ID" },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { purchasePrice: { type: "number" }, quantity: { type: "integer" }, notes: { type: "string" }, purchaseSource: { type: "string" } } } } },
        },
        responses: {
          200: { description: "Card updated", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, card: { $ref: "#/components/schemas/PortfolioCard" } } } } } },
          404: { description: "Card not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key from casecomp.xyz/developers. Format: cc_live_...",
      },
    },
    schemas: {
      SearchResult: {
        type: "object",
        properties: {
          query: { type: "string" },
          source: { type: "string" },
          listingFormat: { type: "string" },
          activeByCountry: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/components/schemas/Listing" } } },
          sold: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
          psaSignal: { $ref: "#/components/schemas/PsaSignal" },
          counts: { type: "object", properties: { activeTotal: { type: "integer" }, sold: { type: "integer" } } },
        },
      },
      SoldResult: {
        type: "object",
        properties: {
          query: { type: "string" },
          sold: { type: "array", items: { $ref: "#/components/schemas/Listing" } },
          soldSource: { type: "string" },
          counts: { type: "object", properties: { sold: { type: "integer" } } },
        },
      },
      Listing: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          itemWebUrl: { type: "string" },
          title: { type: "string" },
          price: { type: "number" },
          priceCurrency: { type: "string" },
          condition: { type: "string" },
          listingGradeLabel: { type: "string", nullable: true },
          imageUrl: { type: "string" },
          additionalImages: { type: "array", items: { type: "object", properties: { imageUrl: { type: "string" } } } },
          grade: { $ref: "#/components/schemas/Grade" },
        },
      },
      Grade: {
        type: "object",
        nullable: true,
        properties: {
          overall: { type: "number" },
          centering: { type: "number" },
          corners: { type: "number" },
          edges: { type: "number" },
          surface: { type: "number" },
          confidence: { type: "number" },
          notes: { type: "string" },
          limitations: { type: "string" },
        },
      },
      PsaSignal: {
        type: "object",
        nullable: true,
        properties: {
          difficulty: { type: "string" },
          psa10Chance: { type: "number", nullable: true },
          psaPopulation: { type: "number", nullable: true },
          psa10Count: { type: "number", nullable: true },
          psa9Count: { type: "number", nullable: true },
          psa9to10Ratio: { type: "number", nullable: true },
        },
      },
      GradeRequest: {
        type: "object",
        required: ["imageUrl"],
        properties: {
          imageUrl: { type: "string" },
          extraImages: { type: "array", items: { type: "string" } },
          provider: { type: "string", default: "claude" },
          model: { type: "string", default: "claude-opus-4-7" },
          cardName: { type: "string" },
          source: { type: "string" },
          listingId: { type: "string" },
          listingPrice: { type: "number" },
          condition: { type: "string" },
        },
      },
      GradeResult: {
        type: "object",
        properties: {
          grade: { $ref: "#/components/schemas/Grade" },
          stored: { type: "boolean" },
        },
      },
      GradeRecord: {
        type: "object",
        properties: {
          ts: { type: "string" },
          cardName: { type: "string" },
          source: { type: "string" },
          listingId: { type: "string" },
          imageUrl: { type: "string" },
          extraImages: { type: "array", items: { type: "string" } },
          provider: { type: "string" },
          model: { type: "string" },
          grade: { $ref: "#/components/schemas/Grade" },
          listingPrice: { type: "number" },
          condition: { type: "string" },
        },
      },
      HealthCheck: {
        type: "object",
        properties: {
          status: { type: "string" },
          uptime: { type: "number" },
          redis: { type: "object", properties: { connected: { type: "boolean" }, latencyMs: { type: "number", nullable: true } } },
        },
      },
      Drop: {
        type: "object",
        properties: {
          id: { type: "string", example: "drp_8h2k" },
          ts: { type: "string", format: "date-time" },
          site: { type: "string", example: "Pokemon Center" },
          status: { type: "string", enum: ["detected", "joined", "waiting", "through", "captcha", "atc-success", "atc-failed", "target-opened"] },
          detail: { type: "string", example: "Queue position #54, ETA 2:31" },
          url: { type: "string" },
          tabId: { type: "integer", nullable: true },
        },
      },
      CompsResult: {
        type: "object",
        properties: {
          query: { type: "string" },
          source: { type: "string" },
          active: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Listing" } }, count: { type: "integer" } } },
          sold: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Listing" } }, count: { type: "integer" } } },
        },
      },
      Webhook: {
        type: "object",
        properties: {
          id: { type: "string", example: "wh_m1a2b3" },
          url: { type: "string", example: "https://you.dev/hook" },
          events: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" },
          active: { type: "boolean" },
        },
      },
      WebhookRequest: {
        type: "object",
        required: ["url", "events"],
        properties: {
          url: { type: "string", description: "Your endpoint URL" },
          events: {
            type: "array",
            items: { type: "string", enum: ["drop.opened", "drop.closed", "queue.joined", "queue.advanced", "queue.through", "checkout.cleared", "captcha.detected", "listing.new"] },
            description: "Events to subscribe to",
          },
        },
      },
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
      PortfolioCard: {
        type: "object",
        properties: {
          cardId: { type: "string", example: "sv8a/217-187" },
          query: { type: "string", example: "Umbreon ex SAR 217/187" },
          addedAt: { type: "string", format: "date-time" },
          purchasePrice: { type: "number", example: 370 },
          purchaseSource: { type: "string", example: "ebay" },
          quantity: { type: "integer", example: 1 },
          notes: { type: "string" },
          currentPrice: { type: "number", example: 400 },
          currentSource: { type: "string" },
          roi: { type: "number", example: 8.11, description: "ROI percentage" },
        },
      },
      PortfolioCardRequest: {
        type: "object",
        required: ["cardId"],
        properties: {
          cardId: { type: "string", example: "sv8a/217-187", description: "Canonical card ID: setCode/number-total" },
          query: { type: "string", example: "Umbreon ex SAR 217/187" },
          purchasePrice: { type: "number", example: 370 },
          purchaseSource: { type: "string", example: "ebay" },
          quantity: { type: "integer", default: 1 },
        },
      },
      PortfolioResponse: {
        type: "object",
        properties: {
          cards: { type: "array", items: { $ref: "#/components/schemas/PortfolioCard" } },
          totalValue: { type: "number" },
          totalCost: { type: "number" },
          totalROI: { type: "number" },
          roiPercent: { type: "number" },
        },
      },
      PortfolioSummary: {
        type: "object",
        properties: {
          totalCards: { type: "integer" },
          uniqueCards: { type: "integer" },
          totalValue: { type: "number" },
          totalCost: { type: "number" },
          totalROI: { type: "number" },
          roiPercent: { type: "number" },
          bestPerformer: { type: "object", nullable: true, properties: { cardId: { type: "string" }, query: { type: "string" }, roi: { type: "number" } } },
          worstPerformer: { type: "object", nullable: true, properties: { cardId: { type: "string" }, query: { type: "string" }, roi: { type: "number" } } },
        },
      },
    },
  },
};
