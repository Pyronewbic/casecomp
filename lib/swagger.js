export const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Casecomp — Pokemon TCG Card Search API",
    version: "1.0.0",
    description: "REST API for searching Pokemon TCG card listings across eBay, SNKRDUNK, magi.camp, and Yahoo Auctions JP. Includes AI pre-grading and PSA population signals.",
    license: { name: "MIT + Commons Clause", url: "https://github.com/Pyronewbic/casecomp/blob/main/LICENSE" },
  },
  servers: [{ url: "http://localhost:3000", description: "Local" }],
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
    "/api/health": {
      get: {
        summary: "Health check",
        responses: {
          200: { description: "Service status", content: { "application/json": { schema: { $ref: "#/components/schemas/HealthCheck" } } } },
        },
      },
    },
  },
  components: {
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
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
};
