import crypto from "crypto";
import { Firestore } from "@google-cloud/firestore";

const COLLECTION = "security-events";

let db = null;
function getDb() {
  if (db) return db;
  try { db = new Firestore(); return db; } catch { return null; }
}

// ── Detection rules ──

export const DETECTION_RULES = [
  { id: "sqli-union", category: "sqli", severity: "high", pattern: /\bunion\s+(all\s+)?select\b/i },
  { id: "sqli-stacked", category: "sqli", severity: "high", pattern: /['"];\s*(drop|alter|insert|update|delete|exec)\b/i },
  { id: "sqli-tautology", category: "sqli", severity: "high", pattern: /\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i },
  { id: "sqli-comment", category: "sqli", severity: "high", pattern: /'\s*(--|#|\/\*)/i },
  { id: "sqli-keyword", category: "sqli", severity: "high", pattern: /\b(select\s+.{1,60}\s+from|insert\s+into|update\s+.{1,60}\s+set|delete\s+from|drop\s+(table|database)|alter\s+table)\b/i },

  { id: "xss-script", category: "xss", severity: "high", pattern: /<script[\s>]/i },
  { id: "xss-protocol", category: "xss", severity: "high", pattern: /javascript\s*:/i },
  { id: "xss-event", category: "xss", severity: "high", pattern: /\bon(error|load|click|mouseover|focus|blur|submit|change|input)\s*=/i },
  { id: "xss-embed", category: "xss", severity: "high", pattern: /<(iframe|embed|object|form)\b/i },
  { id: "xss-svg", category: "xss", severity: "high", pattern: /<svg[\s/][^>]*on\w+\s*=/i },

  { id: "cmdi-semicolon", category: "cmdi", severity: "critical", pattern: /;\s*(ls|cat|rm|wget|curl|bash|sh|nc|netcat|python|perl|ruby|php)\b/i },
  { id: "cmdi-pipe", category: "cmdi", severity: "critical", pattern: /\|\s*(ls|cat|rm|wget|curl|bash|sh|nc|python|perl)\b/i },
  { id: "cmdi-backtick", category: "cmdi", severity: "critical", pattern: /`[^`]{2,}`/ },
  { id: "cmdi-subshell", category: "cmdi", severity: "critical", pattern: /\$\([^)]{2,}\)/ },

  { id: "traversal-dotdot", category: "traversal", severity: "high", pattern: /(\.\.\/)|(\.\.\\)/ },
  { id: "traversal-encoded", category: "traversal", severity: "high", pattern: /(%2e%2e%2f|%2e%2e\/|\.\.%2f|%252e%252e)/i },
  { id: "traversal-etc", category: "traversal", severity: "high", pattern: /\/etc\/(passwd|shadow|hosts)|\/proc\/self/i },

  { id: "nosqli-operator", category: "nosqli", severity: "high", pattern: /\$(?:gt|gte|lt|lte|ne|eq|in|nin|regex|exists|where|elemMatch|or|and|not|nor)\b/ },
];

const SCORE_MAP = { sqli: 30, xss: 25, cmdi: 40, traversal: 20, proto: 35, nosqli: 25, bot: 15 };

const SCANNER_PATTERNS = /sqlmap|nikto|nmap|dirbuster|gobuster|wfuzz|hydra|burpsuite|acunetix|nessus/i;
const ZAP_PATTERN = /zaproxy|owasp.*zap/i;

// ── Detection functions ──

export function detectSqli(input) {
  if (typeof input !== "string") return null;
  for (const rule of DETECTION_RULES) {
    if (rule.category === "sqli" && rule.pattern.test(input)) return { ruleId: rule.id, severity: rule.severity };
  }
  return null;
}

export function detectXss(input) {
  if (typeof input !== "string") return null;
  for (const rule of DETECTION_RULES) {
    if (rule.category === "xss" && rule.pattern.test(input)) return { ruleId: rule.id, severity: rule.severity };
  }
  return null;
}

export function detectCommandInjection(input) {
  if (typeof input !== "string") return null;
  for (const rule of DETECTION_RULES) {
    if (rule.category === "cmdi" && rule.pattern.test(input)) return { ruleId: rule.id, severity: rule.severity };
  }
  return null;
}

export function detectPathTraversal(input) {
  if (typeof input !== "string") return null;
  for (const rule of DETECTION_RULES) {
    if (rule.category === "traversal" && rule.pattern.test(input)) return { ruleId: rule.id, severity: rule.severity };
  }
  return null;
}

export function detectNoSqlInjection(input) {
  if (typeof input !== "string") return null;
  for (const rule of DETECTION_RULES) {
    if (rule.category === "nosqli" && rule.pattern.test(input)) return { ruleId: rule.id, severity: rule.severity };
  }
  return null;
}

const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function detectPrototypePollution(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 50)) {
      const r = detectPrototypePollution(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const keys = Object.keys(obj);
  for (const key of keys.slice(0, 50)) {
    if (POLLUTION_KEYS.has(key)) return { ruleId: "proto-key", severity: "high" };
    if (typeof obj[key] === "object") {
      const r = detectPrototypePollution(obj[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

export function fingerprintRequest(req) {
  const flags = [];
  const ua = req.headers?.["user-agent"] || "";

  if (!ua) flags.push("missing-ua");
  else if (SCANNER_PATTERNS.test(ua)) flags.push("scanner-ua");
  else if (ZAP_PATTERN.test(ua)) flags.push("zap-ua");

  if (ua && /mozilla|chrome|safari/i.test(ua) && !req.headers?.accept) flags.push("missing-accept");

  const headerCount = Object.keys(req.headers || {}).length;
  if (headerCount < 2) flags.push("few-headers");
  if (headerCount > 30) flags.push("many-headers");

  const botScore = flags.reduce((s, f) => s + (f === "zap-ua" ? 5 : 15), 0);
  return { botScore, flags };
}

// ── Input extraction ──

function extractInputStrings(req) {
  const inputs = [];

  if (req.query) {
    for (const [key, val] of Object.entries(req.query)) {
      if (typeof val === "string") inputs.push({ source: "query", key, value: val });
      inputs.push({ source: "query-key", key, value: key });
    }
  }

  if (req.path) inputs.push({ source: "path", key: "path", value: req.path });

  if (req.body && typeof req.body === "object") {
    walkObject(req.body, "body", inputs, 0);
  }

  const checkHeaders = ["referer", "x-forwarded-for"];
  for (const h of checkHeaders) {
    if (req.headers?.[h]) inputs.push({ source: "header", key: h, value: req.headers[h] });
  }

  return inputs;
}

function walkObject(obj, source, inputs, depth) {
  if (!obj || typeof obj !== "object" || depth > 5 || inputs.length > 100) return;
  const entries = Array.isArray(obj) ? obj.map((v, i) => [String(i), v]) : Object.entries(obj);
  for (const [key, val] of entries.slice(0, 50)) {
    inputs.push({ source, key, value: key });
    if (typeof val === "string") {
      inputs.push({ source, key, value: val });
    } else if (typeof val === "object" && val !== null) {
      walkObject(val, source, inputs, depth + 1);
    }
  }
}

// ── Anomaly scoring ──

const MAX_ENTRIES = 10000;
const HALF_LIFE_MS = 5 * 60 * 1000;
const anomalyMap = new Map();

function hashIp(ip) {
  if (!ip) return "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 8);
}

function getOrCreateEntry(ipHash) {
  let entry = anomalyMap.get(ipHash);
  const now = Date.now();
  if (entry) {
    const elapsed = now - entry.lastUpdate;
    entry.score *= Math.pow(0.5, elapsed / HALF_LIFE_MS);
    entry.lastUpdate = now;
  } else {
    if (anomalyMap.size >= MAX_ENTRIES) {
      let oldest = null, oldestKey = null;
      for (const [k, v] of anomalyMap) {
        if (!oldest || v.lastUpdate < oldest.lastUpdate) { oldest = v; oldestKey = k; }
      }
      if (oldestKey) anomalyMap.delete(oldestKey);
    }
    entry = { score: 0, lastUpdate: now };
    anomalyMap.set(ipHash, entry);
  }
  return entry;
}

export function getAnomalyScore(ipHash) {
  const entry = anomalyMap.get(ipHash);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.lastUpdate;
  return entry.score * Math.pow(0.5, elapsed / HALF_LIFE_MS);
}

export function resetAnomalyScores() {
  anomalyMap.clear();
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of anomalyMap) {
    const score = entry.score * Math.pow(0.5, (now - entry.lastUpdate) / HALF_LIFE_MS);
    if (score < 1) anomalyMap.delete(key);
  }
}, 10 * 60 * 1000);
cleanupInterval.unref();

// ── Firestore logging ──

function sanitizeSnippet(val) {
  if (typeof val !== "string") return "";
  return val.slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function logSecurityEvent(event) {
  const fs = getDb();
  if (!fs) return;
  try { await fs.collection(COLLECTION).add(event); } catch {}
}

export async function getSecurityEvents({ days = 7, limit = 200, category = null } = {}) {
  const fs = getDb();
  if (!fs) return [];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    let ref = fs.collection(COLLECTION).where("ts", ">=", cutoff).orderBy("ts", "desc").limit(limit);
    if (category) ref = ref.where("category", "==", category);
    const snap = await ref.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// ── Middleware ──

const detectors = [
  { fn: detectSqli, category: "sqli" },
  { fn: detectXss, category: "xss" },
  { fn: detectCommandInjection, category: "cmdi" },
  { fn: detectPathTraversal, category: "traversal" },
  { fn: detectNoSqlInjection, category: "nosqli" },
];

export function raspMiddleware({ mode = "monitor" } = {}) {
  const shouldBlock = mode === "block";

  return (req, res, next) => {
    req.requestId = req.requestId || crypto.randomUUID().slice(0, 8);

    const ipHash = hashIp(req.ip);
    const entry = getOrCreateEntry(ipHash);
    const detections = [];

    const inputs = extractInputStrings(req);

    for (const input of inputs) {
      for (const { fn, category } of detectors) {
        const result = fn(input.value);
        if (result) {
          detections.push({ ...result, category, source: input.source, key: input.key, value: input.value });
        }
      }
    }

    if (req.body && typeof req.body === "object") {
      const proto = detectPrototypePollution(req.body);
      if (proto) {
        detections.push({ ...proto, category: "proto", source: "body", key: "__proto__", value: "" });
      }
    }

    const fp = fingerprintRequest(req);
    entry.score += fp.botScore;

    for (const det of detections) {
      entry.score += SCORE_MAP[det.category] || 20;
    }

    const action = shouldBlock && (detections.length > 0 || entry.score >= 100) ? "block" : "monitor";

    if (detections.length > 0 || fp.flags.length > 0) {
      const ua = (req.headers?.["user-agent"] || "").slice(0, 200);
      for (const det of detections) {
        logSecurityEvent({
          ts: new Date().toISOString(),
          requestId: req.requestId,
          ipHash,
          path: req.path,
          method: req.method,
          category: det.category,
          ruleId: det.ruleId,
          severity: det.severity,
          source: det.source,
          key: det.key,
          snippet: sanitizeSnippet(det.value),
          action,
          anomalyScore: Math.round(entry.score),
          userAgent: ua,
        }).catch(() => {});
      }

      if (fp.flags.length > 0 && !detections.length) {
        logSecurityEvent({
          ts: new Date().toISOString(),
          requestId: req.requestId,
          ipHash,
          path: req.path,
          method: req.method,
          category: "bot",
          ruleId: fp.flags.join(","),
          severity: "low",
          source: "headers",
          key: "user-agent",
          snippet: ua,
          action: "monitor",
          anomalyScore: Math.round(entry.score),
          userAgent: ua,
        }).catch(() => {});
      }
    }

    if (action === "block") {
      return res.status(403).json({ error: "Request blocked by security policy", requestId: req.requestId });
    }

    next();
  };
}
