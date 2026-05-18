import { Firestore } from "@google-cloud/firestore";

const db = new Firestore({ projectId: "casecomp-test" });

const SEED_API_KEY = {
  id: "key_test_seed",
  keyHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  keyPrefix: "CC_LIVE_testkey1...",
  label: "Test seed key",
  ownerId: "test-user-123",
  rateLimit: 60,
  active: true,
  createdAt: new Date().toISOString(),
  requestCount: 0,
};

const SEED_GRADE_LOG = {
  ts: new Date().toISOString(),
  userId: "test-user-123",
  cardId: "sv8a/217-187",
  cardName: "Umbreon ex",
  source: "api",
  imageUrl: "https://i.ebayimg.com/images/g/XYkAAeSw8fBp9JS-/s-l1600.jpg",
  extraImages: [],
  provider: "claude",
  model: "claude-sonnet-4-6",
  grade: {
    mode: "llm-detailed-v3",
    overall: 8,
    frontOverall: 8.5,
    backOverall: 7,
    centering: 8, corners: 7, edges: 8, surface: 8,
    confidence: 0.75,
    notes: "Grade limiter: corners_back — minor whitening",
    limitations: "",
    subgradeDetails: {
      centering_front: { score: 9, confidence: 0.8, detail: "Even borders", lr: "52/48", tb: "51/49" },
      centering_back: { score: 8, confidence: 0.7, detail: "Slight shift", lr: "55/45", tb: "52/48" },
      corners_front: { score: 8, confidence: 0.7, detail: "Minor whitening top-right" },
      corners_back: { score: 7, confidence: 0.6, detail: "Whitening on back corners" },
      edges_front: { score: 9, confidence: 0.8, detail: "Clean edges" },
      edges_back: { score: 7, confidence: 0.6, detail: "Light whitening" },
      surface_front: { score: 9, confidence: 0.7, detail: "Clean surface" },
      surface_back: { score: 8, confidence: 0.6, detail: "Minor scuffing" },
    },
    gradeDistribution: { "8": 65, "8.5": 12, "7.5": 23 },
    tokenUsage: { input: 15000, output: 700 },
    estimatedCost: 0.055,
  },
};

const SEED_PORTFOLIO_CARD = {
  cardId: "sv8a/217-187",
  name: "Umbreon ex",
  quantity: 1,
  purchasePrice: 370,
  currentPrice: 400,
  addedAt: new Date().toISOString(),
};

const SEED_ANALYTICS = {
  ts: new Date().toISOString(),
  userId: "test-user-123",
  path: "/api/search",
  tier: "developer",
  latencyMs: 150,
  status: 200,
};

async function seed() {
  console.log("Seeding Firestore emulator...");

  await db.collection("api-keys").doc(SEED_API_KEY.id).set(SEED_API_KEY);
  console.log("  api-keys: 1 key");

  const gradeRef = await db.collection("grade-logs").add({
    ...SEED_GRADE_LOG,
    createdAt: Firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  grade-logs: 1 grade (${gradeRef.id})`);

  await db.collection("portfolios").doc("test-user-123").collection("cards").doc("sv8a_217-187").set(SEED_PORTFOLIO_CARD);
  console.log("  portfolios: 1 card");

  await db.collection("api-analytics").add({
    ...SEED_ANALYTICS,
    createdAt: Firestore.FieldValue.serverTimestamp(),
  });
  console.log("  api-analytics: 1 record");

  console.log("Seed complete.");
}

seed().catch(e => { console.error("Seed failed:", e.message); process.exit(1); });
