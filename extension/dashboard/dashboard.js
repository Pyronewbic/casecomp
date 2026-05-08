const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const STORAGE_KEYS = [
  "enabled", "sites", "log", "monitorStatus",
  "discordChannels", "discordKeywords", "redditSubs", "targetUrls", "logArchive",
  "checkoutLog", "autoCheckout", "imapConfig", "proxyConfig",
];

const SITE_ICONS = {
  "pokemon-center":    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></svg>',
  "pokemon-center-jp": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/><path d="M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" stroke-width="1" opacity=".4"/></svg>',
  "walmart":           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2.9" y1="7" x2="7.2" y2="9.5"/><line x1="16.8" y1="14.5" x2="21.1" y2="17"/><line x1="2.9" y1="17" x2="7.2" y2="14.5"/><line x1="16.8" y1="9.5" x2="21.1" y2="7"/></svg>',
  "costco":            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/><line x1="12" y1="12" x2="12" y2="16"/></svg>',
  "discord":           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM14.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor" stroke="none"/><path d="M5.5 16s1.5 2 6.5 2 6.5-2 6.5-2"/><path d="M20 7.5c-1.5-1-3.2-1.7-5-2l-.5 1.2M4 7.5c1.5-1 3.2-1.7 5-2l.5 1.2"/><path d="M3 12c0 4 2 7.5 4.5 9l1-2M21 12c0 4-2 7.5-4.5 9l-1-2"/></svg>',
};

const MONITORS = [
  { id: "pokemon-center",    label: "Pokémon Center US", letter: "P" },
  { id: "pokemon-center-jp", label: "Pokémon Center JP", letter: "P" },
  { id: "walmart",           label: "Walmart",           letter: "W" },
  { id: "costco",            label: "Costco",            letter: "C" },
];

const SITE_NAME_TO_ID = {
  "Pokémon Center": "pokemon-center",
  "Pokemon Center": "pokemon-center",
  "PC Japan": "pokemon-center-jp",
  "Walmart": "walmart",
  "Costco": "costco",
  "discord": "discord",
};

const WORKER_STATUSES = new Set([
  "detected", "joined", "waiting", "through", "captcha",
  "atc-success", "atc-failed", "target-opened",
  "checkout-shipping", "checkout-payment", "checkout-review",
  "checkout-success", "checkout-failed", "verification-filled",
]);

const STATUS_TO_PILL = {
  through:              "pill-through",
  detected:             "pill-detected",
  joined:               "pill-joined",
  waiting:              "pill-waiting",
  captcha:              "pill-captcha",
  "atc-success":        "pill-atc",
  "atc-failed":         "pill-detected",
  "target-opened":      "pill-detected",
  "discord-intel":      "pill-intel",
  "new-listing":        "pill-new",
  "checkout-shipping":  "pill-joined",
  "checkout-payment":   "pill-joined",
  "checkout-review":    "pill-waiting",
  "checkout-success":   "pill-through",
  "checkout-failed":    "pill-captcha",
  "verification-filled":"pill-intel",
};

const STATUS_TO_DATA = {
  through: "through",
  waiting: "waiting",
  captcha: "alert",
  "atc-success": "through",
  "discord-intel": "intel",
};

let currentTab = "workers";
let currentSearch = "";
let logData = [];
let archiveData = [];
let _lastTargets = [];

function isWorkerEntry(e) {
  return WORKER_STATUSES.has(e.status) || e.site === "system";
}

function renderAnalytics(period) {
  period = period || "day";
  const el = $("#analytics-cards");
  const chartEl = $("#analytics-chart");
  const tableEl = $("#analytics-checkouts");
  if (!el) return;

  // Compute stats from logData
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const periodMs = period === "month" ? 30 * day : period === "week" ? 7 * day : day;
  const periodEntries = logData.filter(e => now - new Date(e.ts).getTime() < periodMs);

  const checkouts = periodEntries.filter(e => e.status === "atc-success" || e.status === "through");
  const failures = periodEntries.filter(e => e.status === "atc-failed" || e.status === "captcha");
  const totalEvents = periodEntries.length;

  // Cards
  el.innerHTML = `
    <div class="a-card highlight">
      <div class="a-card-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg></div>
      <div class="a-card-body"><div class="a-card-label">Events</div><div class="a-card-value">${totalEvents}</div></div>
    </div>
    <div class="a-card">
      <div class="a-card-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg></div>
      <div class="a-card-body"><div class="a-card-label">Checkouts</div><div class="a-card-value">${checkouts.length}</div></div>
    </div>
    <div class="a-card">
      <div class="a-card-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
      <div class="a-card-body"><div class="a-card-label">Queues Joined</div><div class="a-card-value">${periodEntries.filter(e => e.status === "joined").length}</div></div>
    </div>
    <div class="a-card">
      <div class="a-card-icon red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div class="a-card-body"><div class="a-card-label">Failures</div><div class="a-card-value">${failures.length}</div></div>
    </div>
  `;

  // Chart - bucket events by time
  const bucketCount = period === "month" ? 12 : period === "week" ? 7 : 24;
  const bucketMs = periodMs / bucketCount;
  const buckets = new Array(bucketCount).fill(0);
  for (const e of periodEntries) {
    const age = now - new Date(e.ts).getTime();
    const idx = bucketCount - 1 - Math.floor(age / bucketMs);
    if (idx >= 0 && idx < bucketCount) buckets[idx]++;
  }

  const max = Math.max(...buckets, 1);
  const chartW = 600;
  const chartH = 140;
  const points = buckets.map((v, i) => {
    const x = bucketCount > 1 ? (i / (bucketCount - 1)) * chartW : 0;
    const y = chartH - (v / max) * (chartH - 10) - 5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPoints = `0,${chartH} ${points} ${chartW},${chartH}`;

  const yLabels = [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];

  let xLabels;
  if (period === "day") {
    xLabels = Array.from({length: 6}, (_, i) => {
      const h = new Date(now - (24 - i * 4) * 3600000).getHours();
      return `${h}:00`;
    });
  } else if (period === "week") {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    xLabels = Array.from({length: 7}, (_, i) => days[new Date(now - (6-i) * day).getDay()]);
  } else {
    xLabels = Array.from({length: 6}, (_, i) => {
      const d = new Date(now - (30 - i * 6) * day);
      return `${d.getMonth()+1}/${d.getDate()}`;
    });
  }

  chartEl.innerHTML = `
    <div class="chart-y-axis">${yLabels.map(v => `<span>${v}</span>`).join("")}</div>
    <svg class="chart-svg" viewBox="0 0 ${chartW} ${chartH}" preserveAspectRatio="none">
      <defs><linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--foil)"/><stop offset="1" stop-color="transparent"/></linearGradient></defs>
      <polygon class="chart-area" points="${areaPoints}"/>
      <polyline points="${points}"/>
    </svg>
    <div class="chart-x-axis">${xLabels.map(l => `<span>${l}</span>`).join("")}</div>
  `;

  // Recent checkouts table
  const recentCheckouts = logData
    .filter(e => e.status === "through" || e.status === "atc-success")
    .slice(0, 10);

  if (!recentCheckouts.length) {
    tableEl.innerHTML = '<div style="color:var(--paper-dd);padding:20px;text-align:center;">No checkouts yet.</div>';
    return;
  }

  const siteNameMap = { "pokemon-center": "Pokemon Center", "walmart": "Walmart", "costco": "Costco", "pokemon-center-jp": "Pokemon Center JP" };

  tableEl.innerHTML = `
    <div class="checkout-table">
      <div class="checkout-header">
        <span>Product</span><span>Price</span><span>Retailer</span><span>Date</span>
      </div>
      ${recentCheckouts.map(e => {
        const slug = slugFromUrl(e.tabUrl) || e.detail || "Unknown product";
        const siteId = SITE_NAME_TO_ID[e.site] || e.site;
        const retailer = siteNameMap[siteId] || e.site || "—";
        const date = new Date(e.ts).toLocaleString([], { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
        const link = e.tabUrl ? `<a class="checkout-product-link" href="${esc(e.tabUrl)}" target="_blank">↗</a>` : "";
        return `<div class="checkout-row">
          <div class="checkout-product"><span class="checkout-product-name">${esc(slug)}</span>${link}</div>
          <span class="checkout-price">—</span>
          <span class="checkout-retailer">${esc(retailer)}</span>
          <span class="checkout-date">${date}</span>
        </div>`;
      }).join("")}
    </div>
  `;
}

function loadSettings(data) {
  const ac = $("#setting-auto-checkout");
  if (ac) ac.checked = data.autoCheckout === true;

  const imap = data.imapConfig || {};
  const ih = $("#setting-imap-host");
  const ip = $("#setting-imap-port");
  const iu = $("#setting-imap-user");
  const ipw = $("#setting-imap-pass");
  const it = $("#setting-imap-tls");
  if (ih) ih.value = imap.host || "";
  if (ip) ip.value = imap.port || 993;
  if (iu) iu.value = imap.user || "";
  if (ipw) ipw.value = imap.pass || "";
  if (it) it.checked = imap.tls !== false;

  const proxy = data.proxyConfig || {};
  const pe = $("#setting-proxy-enabled");
  const ph = $("#setting-proxy-host");
  const pp = $("#setting-proxy-port");
  const pu = $("#setting-proxy-user");
  const ppw = $("#setting-proxy-pass");
  const pt = $("#setting-proxy-type");
  if (pe) pe.checked = proxy.enabled === true;
  if (ph) ph.value = proxy.host || "";
  if (pp) pp.value = proxy.port || "";
  if (pu) pu.value = proxy.user || "";
  if (ppw) ppw.value = proxy.pass || "";
  if (pt) pt.value = proxy.type || "http";
}

function saveSettingsField(key, value) {
  chrome.storage.local.set({ [key]: value });
}

function collectImapConfig() {
  return {
    host: $("#setting-imap-host")?.value || "",
    port: parseInt($("#setting-imap-port")?.value) || 993,
    user: $("#setting-imap-user")?.value || "",
    pass: $("#setting-imap-pass")?.value || "",
    tls: $("#setting-imap-tls")?.checked !== false,
  };
}

function collectProxyConfig() {
  return {
    enabled: $("#setting-proxy-enabled")?.checked === true,
    host: $("#setting-proxy-host")?.value || "",
    port: $("#setting-proxy-port")?.value || "",
    user: $("#setting-proxy-user")?.value || "",
    pass: $("#setting-proxy-pass")?.value || "",
    type: $("#setting-proxy-type")?.value || "http",
  };
}

function load() {
  chrome.storage.local.get(STORAGE_KEYS, (data) => {
    $("#enabled").checked = data.enabled !== false;
    syncEngineState();
    logData = data.log || [];
    archiveData = data.logArchive || [];
    renderFeeds();
    renderChannels(data.discordChannels || []);
    renderSubs(data.redditSubs || ["PKMNTCGDeals", "PokemonTCG"]);
    renderKeywords(data.discordKeywords || []);
    renderTargets(data.targetUrls || []);
    loadSettings(data);
  });
}


function renderFeeds() {
  const workers = logData.filter((e) => WORKER_STATUSES.has(e.status) && e.site !== "system");

  // Inject placeholder for armed targets with no worker log
  const cachedTargets = _lastTargets || [];
  const siteNames = { "pokemon-center": "Pokémon Center", "pokemon-center-jp": "Pokémon Center JP", "walmart": "Walmart", "costco": "Costco" };
  for (const t of cachedTargets) {
    if (!t.active) continue;
    const hasWorker = workers.some((e) => {
      if (e.tabUrl === t.url) return true;
      try { return new URL(e.tabUrl).hostname === new URL(t.url).hostname; } catch { return false; }
    });
    if (!hasWorker) {
      const siteId = siteIdFromUrl(t.url);
      workers.push({
        ts: t.addedAt || new Date().toISOString(),
        site: siteNames[siteId] || "Unknown",
        status: "detected",
        detail: "Armed — waiting for page to load",
        tabUrl: t.url,
      });
    }
  }

  renderWorkerPanel($("#feed-workers"), workers);
  const news = logData.filter((e) => !isWorkerEntry(e));
  renderFlatPanel($("#news-feed"), news);
  renderHistory($("#history-content"));
  renderRawLog($("#feed-logs"));
  renderAnalytics();
  renderFeedKPIs(workers);
  const totalEvents = logData.length;
  const lastEntry = logData[0];
  const lastTs = lastEntry ? new Date(lastEntry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const feedMeta = $("#feed-meta");
  if (feedMeta) feedMeta.textContent = totalEvents ? `${totalEvents} EVENTS · LAST ${lastTs}` : "";
  $("#workers-count").textContent = workers.length ? new Set(workers.map((e) => e.site)).size : 0;
  $("#news-count").textContent = news.length;
  $("#history-count").textContent = archiveData.length;
}

function _sparkPoints(arr, w, h) {
  w = w || 120;
  h = h || 28;
  if (!arr.length) return "";
  const max = Math.max(...arr, 1);
  const step = w / Math.max(arr.length - 1, 1);
  return arr.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
}

function _bucketBy(entries, bucketMs, count) {
  const now = Date.now();
  const buckets = new Array(count).fill(0);
  for (const e of entries) {
    const age = now - new Date(e.ts).getTime();
    const idx = count - 1 - Math.min(Math.floor(age / bucketMs), count - 1);
    buckets[idx]++;
  }
  return buckets;
}

function _ensureSvgDefs() {
  if (document.getElementById("__kpi-svg-defs")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("id", "__kpi-svg-defs");
  svg.style.position = "absolute";
  svg.innerHTML = `<defs>
    <linearGradient id="holoGrad" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="var(--holo-c)"/>
      <stop offset=".5" stop-color="var(--holo-m)"/>
      <stop offset="1" stop-color="var(--holo-y)"/>
    </linearGradient>
    <linearGradient id="sgFoil" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="var(--foil-hi)"/>
      <stop offset="1" stop-color="var(--foil-lo)"/>
    </linearGradient>
  </defs>`;
  document.body.appendChild(svg);
}

function renderFeedKPIs(workers) {
  const el = $("#feed-kpis");
  if (!el) return;

  _ensureSvgDefs();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const recent = workers.filter((e) => now - new Date(e.ts).getTime() < day);

  const armed = workers.filter((e) => e.status !== "through").length;
  const queued = recent.filter((e) => e.status === "waiting" || e.status === "joined").length;

  let bestPos = null;
  for (const e of recent) {
    const m = (e.detail || "").match(/pos(?:ition)?[\s:]*#?(\d+)/i);
    if (m) {
      const p = parseInt(m[1], 10);
      if (bestPos === null || p < bestPos) bestPos = p;
    }
  }
  const bestPosLabel = bestPos !== null ? String(bestPos) : "—";

  let fastest = null;
  const joinMap = new Map();
  for (let i = workers.length - 1; i >= 0; i--) {
    const e = workers[i];
    const id = SITE_NAME_TO_ID[e.site] || e.site;
    if (e.status === "joined") joinMap.set(id, new Date(e.ts).getTime());
    else if (e.status === "through" && joinMap.has(id)) {
      const d = new Date(e.ts).getTime() - joinMap.get(id);
      if (d > 0 && (fastest === null || d < fastest)) fastest = d;
      joinMap.delete(id);
    }
  }
  const etaLabel = fastest !== null ? `${Math.floor(fastest / 60000)}m ${Math.round((fastest % 60000) / 1000)}s` : "—";

  const todayCount = logData.length;

  const bucketMs = day / 12;
  const armedBuckets = _bucketBy(workers.filter((e) => e.status !== "through"), bucketMs, 12);
  const queueBuckets = _bucketBy(recent.filter((e) => e.status === "waiting" || e.status === "joined"), bucketMs, 12);
  const posBuckets = _bucketBy(recent, bucketMs, 12);
  const etaBuckets = _bucketBy(workers, bucketMs, 12);
  const todayBuckets = _bucketBy(recent, bucketMs, 12);

  el.classList.add("kpi-bar");
  el.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-head"><span class="lbl">Armed</span><span class="hint">active</span></div>
      <div class="val">${armed}</div>
      <svg class="kpi-spark" viewBox="0 0 120 28"><polyline points="${_sparkPoints(armedBuckets)}"/></svg>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="lbl">In Queue</span><span class="hint">24h</span></div>
      <div class="val">${queued}</div>
      <svg class="kpi-spark" viewBox="0 0 120 28"><polyline points="${_sparkPoints(queueBuckets)}"/></svg>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="lbl">Best Pos</span><span class="hint">24h low</span></div>
      <div class="val holo">${bestPosLabel}</div>
      <svg class="kpi-spark holo" viewBox="0 0 120 28"><polyline points="${_sparkPoints(posBuckets)}" stroke="url(#holoGrad)"/></svg>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="lbl">ETA</span><span class="hint">best clear</span></div>
      <div class="val">${etaLabel}</div>
      <svg class="kpi-spark" viewBox="0 0 120 28"><polyline points="${_sparkPoints(etaBuckets)}"/></svg>
    </div>
    <div class="kpi-card">
      <div class="kpi-head"><span class="lbl">Today</span><span class="hint">events</span></div>
      <div class="val">${todayCount}</div>
      <svg class="kpi-spark" viewBox="0 0 120 28"><polyline points="${_sparkPoints(todayBuckets)}"/></svg>
    </div>
  `;
}

function renderHistory(el) {
  const workerOnly = archiveData.filter((e) => WORKER_STATUSES.has(e.status) || e.site === "system");
  const entries = filterBySearch(workerOnly);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--paper-dd);padding:40px;text-align:center;">No archived worker runs yet.</div>';
    return;
  }

  const byTarget = new Map();
  for (const e of entries) {
    const slug = slugFromUrl(e.tabUrl);
    const key = slug || e.reason || "unknown";
    if (!byTarget.has(key)) byTarget.set(key, { entries: [], archivedAt: e.archivedAt, reason: e.reason });
    byTarget.get(key).entries.push(e);
  }

  el.innerHTML = [...byTarget.entries()].map(([target, group]) => {
    const { entries: items, archivedAt, reason } = group;
    const ts = archivedAt ? new Date(archivedAt).toLocaleString() : "—";
    const siteId = SITE_NAME_TO_ID[items[0]?.site] || "";
    const icon = SITE_ICONS[siteId] || "";
    const siteName = items[0]?.site || "system";
    const reasonLabel = reason || "tab closed";

    const rows = items.map((e) => {
      const pillClass = STATUS_TO_PILL[e.status] || "pill-idle";
      const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `<div class="entry">
        <span class="ts">${time}</span>
        <span class="pill ${pillClass}">${esc(e.status.replace(/-/g, " "))}</span>
        <span class="msg">${esc(e.detail || "")}</span>
        <span class="qty">—</span>
      </div>`;
    }).join("");

    return `<details class="site-group" data-status="intel">
      <summary>
        <div class="sg-icon">${icon || "⌫"}</div>
        <div class="sg-body">
          <div class="sg-name">${esc(siteName)} · ${esc(target)}</div>
          <div class="sg-detail">${items.length} events · ${esc(reasonLabel)} · ${ts}</div>
        </div>
        <span class="pill pill-idle">${items.length}</span>
      </summary>
      <div class="sg-entries">${rows}</div>
    </details>`;
  }).join("");
}

function renderRawLog(el) {
  const all = [...logData.map((e) => ({ ...e, _src: "live" })), ...archiveData.map((e) => ({ ...e, _src: "archive" }))];
  all.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const entries = filterBySearch(all);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--paper-dd);padding:40px;text-align:center;font-family:var(--font-mono);font-size:11px;">No log entries.</div>';
    return;
  }
  const rows = entries.slice(0, 500).map((e, i) => {
    const ts = new Date(e.ts).toISOString().replace("T", " ").replace("Z", "");
    const siteId = SITE_NAME_TO_ID[e.site] || e.site.toLowerCase().replace(/\s+/g, "-");
    const slug = slugFromUrl(e.tabUrl);
    const srcTag = e._src === "archive" ? `<span class="raw-archived">ARC</span> ` : "";
    return `<div class="raw-row${i % 2 === 0 ? "" : " alt"}${e._src === "archive" ? " archived" : ""}"><span class="raw-idx">${i}</span><span class="raw-ts">${ts}</span><span class="raw-site">${esc(siteId)}</span><span class="raw-status">${esc(e.status)}</span><span class="raw-detail">${srcTag}${slug ? `<span class="raw-slug">${esc(slug)}</span> ` : ""}${esc(e.detail || "—")}</span></div>`;
  }).join("");
  el.innerHTML = `<div class="raw-header"><span class="raw-idx">#</span><span class="raw-ts">TIMESTAMP</span><span class="raw-site">SITE</span><span class="raw-status">STATUS</span><span class="raw-detail">DETAIL</span></div>${rows}`;
}

function filterBySearch(entries) {
  if (!currentSearch) return entries;
  const q = currentSearch.toLowerCase();
  return entries.filter((e) =>
    (e.detail || "").toLowerCase().includes(q) ||
    e.site.toLowerCase().includes(q) ||
    e.status.toLowerCase().includes(q)
  );
}

function renderWorkerPanel(el, entries) {
  entries = filterBySearch(entries);
  if (!entries.length) {
    const existingInput = el.querySelector("#empty-url-input");
    if (existingInput && document.activeElement === existingInput) return;

    el.innerHTML = `<div class="empty-state">
      <div class="empty-hero">
        <div class="empty-logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
            <rect x="21" y="26.5" width="50" height="67" rx="4" ry="4" fill="#14151c" stroke="#d9b676" stroke-width="1.6" transform="rotate(-7.5,46,60)" opacity=".5"/>
            <rect x="57" y="34.5" width="50" height="67" rx="4" ry="4" fill="#1c1e27" stroke="#d9b676" stroke-width="2.4" transform="rotate(7.5,82,68)" opacity=".5"/>
            <polyline fill="none" stroke="#d9b676" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="16,64 40,64 48,44 56,80 64,50 72,64 112,64" opacity=".4"/>
          </svg>
        </div>
        <div class="empty-title" style="color:var(--foil)">No activity yet</div>
        <div class="empty-sub">Drop a target URL below or open a supported site to deploy your first worker.</div>
        <div class="empty-quick-add">
          <input type="text" id="empty-url-input" placeholder="https://www.pokemoncenter.com/product/...">
          <button id="empty-url-add">+ Add Target</button>
        </div>
      </div>
      <div class="empty-bottom">
        <div class="step-cards">
          <div class="step-card"><div class="step-num">STEP 01</div><div class="step-title">Add Targets</div><div class="step-desc">Paste product URLs you want monitored.</div></div>
          <div class="step-card"><div class="step-num">STEP 02</div><div class="step-title">Arm Engine</div><div class="step-desc">Toggle the engine on; workers deploy on supported pages.</div></div>
          <div class="step-card"><div class="step-num">STEP 03</div><div class="step-title">Watch the Queue</div><div class="step-desc">Position, ETA, and queue movement update live.</div></div>
        </div>
        <div class="site-chips">
          <div class="site-chip"><span class="sc-icon">${SITE_ICONS["pokemon-center"]}</span><span>Pokémon Center</span></div>
          <div class="site-chip"><span class="sc-icon">${SITE_ICONS["pokemon-center-jp"]}</span><span>Pokémon Center JP</span></div>
          <div class="site-chip"><span class="sc-icon">${SITE_ICONS["walmart"]}</span><span>Walmart</span></div>
          <div class="site-chip"><span class="sc-icon">${SITE_ICONS["costco"]}</span><span>Costco</span></div>
        </div>
      </div>
    </div>`;
    const addBtn = el.querySelector("#empty-url-add");
    const urlInput = el.querySelector("#empty-url-input");
    if (addBtn) addBtn.addEventListener("click", () => {
      const raw = urlInput.value.trim();
      if (!raw) return;
      const label = slugFromUrl(raw);
      chrome.runtime.sendMessage({ type: "ADD_TARGET_URL", url: raw, label }, () => {
        $('[data-tab="targets"]').click();
      });
    });
    if (urlInput) urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBtn.click(); });
    const newsBtn = el.querySelector("#empty-setup-news");
    if (newsBtn) newsBtn.addEventListener("click", () => $('[data-tab="news"]').click());
    return;
  }

  const bySite = new Map();
  for (const e of entries) {
    const slug = slugFromUrl(e.tabUrl);
    const key = slug ? `${e.site}::${slug}` : e.site;
    if (!bySite.has(key)) bySite.set(key, { site: e.site, slug, entries: [] });
    bySite.get(key).entries.push(e);
  }

  el.innerHTML = [...bySite.values()].map((group) => {
    const { site, slug, entries: siteEntries } = group;
    const grouped = groupConsecutive(siteEntries.slice(0, 100));
    const latest = grouped[0];
    const pillClass = STATUS_TO_PILL[latest.status] || "pill-idle";
    const dataStatus = STATUS_TO_DATA[latest.status] || "waiting";
    const siteId = SITE_NAME_TO_ID[site] || site.toLowerCase().replace(/\s+/g, "-");
    const monitor = MONITORS.find((m) => m.id === siteId);
    const iconSvg = SITE_ICONS[siteId] || monitor?.letter || site[0];
    const region = monitor ? monitor.label.split(" ").pop() : "";
    const eta = extractEta(latest.detail);
    const etaHtml = eta ? `<div class="sg-eta"><span class="v">${eta}</span><span class="l">ETA</span></div>` : `<div class="sg-eta"><span class="v">—</span><span class="l">—</span></div>`;
    const slugHtml = slug ? `<span class="sg-slug">${esc(slug)}</span>` : "";
    const detailText = latest.detail || "";

    const rows = grouped.map((g) => {
      const bc = STATUS_TO_PILL[g.status] || "pill-idle";
      const time = new Date(g.endTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const cl = g.count > 1 ? ` x${g.count}` : "";
      const rowSlug = slugFromUrl(g.tabUrl);
      const rowSlugHtml = rowSlug ? `<span class="entry-slug">${esc(rowSlug)}</span>` : "";
      return `<div class="entry">
        <span class="ts">${time}</span>
        <span class="pill ${bc}">${esc(g.status.replace(/-/g, " "))}${cl}</span>
        <span class="msg">${esc(g.detail || "")}</span>
        <span class="qty">${rowSlugHtml}</span>
      </div>`;
    }).join("");

    return `<details class="site-group" data-status="${dataStatus}" open>
      <summary>
        <div class="sg-icon">${iconSvg}</div>
        <div class="sg-body">
          <div class="sg-name">${esc(site)} <span class="sg-region">${esc(region)}</span> ${slugHtml}</div>
          <div class="sg-detail">${esc(detailText)}</div>
        </div>
        <span class="pill ${pillClass}">${esc(latest.status.replace(/-/g, " "))}</span>
        ${etaHtml}
      </summary>
      <div class="sg-entries">${rows}</div>
    </details>`;
  }).join("");
}

const NEWS_ICONS = {
  discord: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM14.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="currentColor" stroke="none"/><path d="M5.5 16s1.5 2 6.5 2 6.5-2 6.5-2"/><path d="M20 7.5c-1.5-1-3.2-1.7-5-2l-.5 1.2M4 7.5c1.5-1 3.2-1.7 5-2l.5 1.2"/><path d="M3 12c0 4 2 7.5 4.5 9l1-2M21 12c0 4-2 7.5-4.5 9l-1-2"/></svg>',
  Reddit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><circle cx="9" cy="11" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.5" fill="currentColor" stroke="none"/><path d="M8.5 15c1 1.5 5.5 1.5 7 0"/><path d="M18 8a2 2 0 1 0-1-1" stroke-width="1.5"/><line x1="12" y1="2" x2="14" y2="5" stroke-width="1.5"/></svg>',
  X:       '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
};

function parseNewsDetail(site, detail) {
  const result = { source: "", title: detail, link: "" };
  if (site === "discord") {
    const m = detail.match(/^#([\w-]+):\s*"?(.+?)"?$/);
    if (m) { result.source = `#${m[1]}`; result.title = m[2]; }
  } else if (site === "Reddit") {
    const m = detail.match(/^r\/([\w]+):\s*(.+)$/);
    if (m) {
      result.source = `r/${m[1]}`;
      result.title = m[2];
      result.link = `https://www.reddit.com/r/${m[1]}/search?q=${encodeURIComponent(m[2].slice(0, 60))}&sort=new`;
    }
  } else if (site === "X") {
    const m = detail.match(/^@([\w]+):\s*"?(.+?)"?$/);
    if (m) {
      result.source = `@${m[1]}`;
      result.title = m[2];
      result.link = `https://x.com/${m[1]}`;
    }
  }
  return result;
}

function renderFlatPanel(el, entries) {
  entries = filterBySearch(entries);
  if (!entries.length) {
    el.innerHTML = '<div style="color:var(--paper-dd);padding:40px;text-align:center;">No news activity yet.</div>';
    return;
  }
  el.innerHTML = entries.slice(0, 200).map((e) => {
    const icon = NEWS_ICONS[e.site] || "";
    const parsed = parseNewsDetail(e.site, e.detail || "");
    const time = new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const date = new Date(e.ts).toLocaleDateString([], { month: "short", day: "numeric" });
    const linkHtml = parsed.link ? `<a class="news-link" href="${esc(parsed.link)}" target="_blank">↗</a>` : "";
    return `<div class="news-row">
      <div class="news-icon">${icon}</div>
      <div class="news-body">
        <div class="news-head">
          <span class="news-source">${esc(e.site)}</span>
          ${parsed.source ? `<span class="news-channel">${esc(parsed.source)}</span>` : ""}
          <span class="news-time">${date} · ${time}</span>
        </div>
        <div class="news-title">${esc(parsed.title)}</div>
      </div>
      ${linkHtml}
    </div>`;
  }).join("");
}

function extractEta(detail) {
  if (!detail) return null;
  const m = detail.match(/ETA:\s*(\d[\d:]+)/);
  return m ? m[1] : null;
}

function siteIdFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("pokemoncenter.com") && !h.includes("-online")) return "pokemon-center";
    if (h.includes("pokemoncenter-online") || h.includes("pokemon.co.jp")) return "pokemon-center-jp";
    if (h.includes("walmart")) return "walmart";
    if (h.includes("costco")) return "costco";
    if (h.includes("pokemon.com")) return "pokemon-center";
  } catch {}
  return null;
}

function renderTargets(urls) {
  _lastTargets = urls;
  const el = $("#dash-url-list");
  if (!el) return;
  const active = urls.filter((u) => u.active).length;
  $("#targets-meta").textContent = `${active} active · ${urls.length} total`;
  const tc = $("#targets-count");
  if (tc) tc.textContent = urls.length;

  if (!urls.length) {
    el.innerHTML = '<div style="color:var(--paper-dd);font-family:var(--font-mono);font-size:11px;padding:14px;text-align:center;">No targets — add a product URL above.</div>';
    return;
  }

  el.innerHTML = urls.map((u) => {
    const cls = u.active ? "target-row active" : "target-row paused";
    const label = u.label || slugFromUrl(u.url) || "target";
    const sId = siteIdFromUrl(u.url);
    const icon = sId && SITE_ICONS[sId] ? SITE_ICONS[sId] : "";
    const statusLabel = u.active ? "armed" : "paused";
    const toggleIcon = u.active
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="1" y1="1" x2="23" y2="23"/><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>';
    return `<div class="${cls}" data-url="${esc(u.url)}">
      <button class="t-check" title="Click to ${u.active ? 'pause' : 'activate'}"><span class="t-box"></span></button>
      <div class="t-icon">${icon}</div>
      <div class="t-body">
        <div class="t-label">${esc(label)}</div>
        <div class="t-url">${esc(u.url)}</div>
      </div>
      <button class="t-toggle-status" title="Click to ${u.active ? 'pause' : 'activate'}">${toggleIcon} ${statusLabel}</button>
      <button class="t-remove" title="Remove target">×</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".t-check").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".target-row").dataset.url;
      chrome.runtime.sendMessage({ type: "TOGGLE_TARGET_URL", url }, (res) => {
        if (res?.urls) renderTargets(res.urls);
      });
    });
  });

  el.querySelectorAll(".t-toggle-status").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".target-row").dataset.url;
      chrome.runtime.sendMessage({ type: "TOGGLE_TARGET_URL", url }, (res) => {
        if (res?.urls) renderTargets(res.urls);
      });
    });
  });

  el.querySelectorAll(".t-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".target-row").dataset.url;
      chrome.runtime.sendMessage({ type: "REMOVE_TARGET_URL", url }, (res) => {
        if (res?.urls) renderTargets(res.urls);
      });
    });
  });
}

function dashAddUrl() {
  const input = $("#dash-url-input");
  const raw = input.value.trim();
  if (!raw) return;
  try {
    const parsed = new URL(raw);
    const allowed = ["www.pokemoncenter.com", "pokemoncenter.com", "www.pokemoncenter-online.com", "pokemoncenter-online.com", "pokemoncenter.pokemon.co.jp", "www.walmart.com", "www.costco.com", "www.pokemon.com", "tcg.pokemon.com"];
    if (!allowed.some((h) => parsed.hostname === h || parsed.hostname.endsWith(".queue-it.net") || parsed.hostname.endsWith(".pokemon.com"))) {
      input.style.borderColor = "var(--pulse)";
      setTimeout(() => { input.style.borderColor = ""; }, 1500);
      return;
    }
  } catch {
    input.style.borderColor = "var(--pulse)";
    setTimeout(() => { input.style.borderColor = ""; }, 1500);
    return;
  }
  const label = slugFromUrl(raw);
  chrome.runtime.sendMessage({ type: "ADD_TARGET_URL", url: raw, label }, (res) => {
    if (res?.urls) renderTargets(res.urls);
    input.value = "";
  });
}

function renderChannels(channels) {
  const el = $("#discord-channels");
  if (!el) return;
  $("#channel-count").textContent = channels.length;
  el.innerHTML = channels.map((ch) =>
    `<span class="tag">#${esc(ch)}<button class="x" data-channel="${esc(ch)}">×</button></span>`
  ).join("");
  el.querySelectorAll(".x").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = btn.dataset.channel;
      chrome.storage.local.get(["discordChannels"], (data) => {
        const arr = (data.discordChannels || []).filter((c) => c !== ch);
        chrome.storage.local.set({ discordChannels: arr });
      });
    });
  });
}

function renderSubs(subs) {
  const el = $("#reddit-subs");
  if (!el) return;
  $("#sub-count").textContent = subs.length;
  el.innerHTML = subs.map((s) =>
    `<span class="tag">r/${esc(s)}<button class="x" data-sub="${esc(s)}">×</button></span>`
  ).join("");
  el.querySelectorAll(".x").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.dataset.sub;
      chrome.storage.local.get(["redditSubs"], (data) => {
        const arr = (data.redditSubs || []).filter((s) => s !== sub);
        chrome.storage.local.set({ redditSubs: arr });
      });
    });
  });
}

function renderKeywords(keywords) {
  const el = $("#keywords");
  if (!el) return;
  $("#keyword-count").textContent = keywords.length;
  el.innerHTML = keywords.map((kw) =>
    `<span class="tag">${esc(kw)}<button class="x" data-keyword="${esc(kw)}">×</button></span>`
  ).join("");
  el.querySelectorAll(".x").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kw = btn.dataset.keyword;
      chrome.storage.local.get(["discordKeywords"], (data) => {
        const arr = (data.discordKeywords || []).filter((k) => k !== kw);
        chrome.storage.local.set({ discordKeywords: arr });
      });
    });
  });
}

function slugFromUrl(url) {
  if (!url) return "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last.replace(/[-_]/g, " ").replace(/\.\w+$/, "").slice(0, 35);
  } catch { return ""; }
}

function groupConsecutive(entries) {
  const groups = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    const tabKey = e.tabId || "";
    const lastTab = last?.tabId || "";
    if (last && last.site === e.site && last.status === e.status && lastTab === tabKey) {
      last.count++;
      last.startTs = e.ts;
    } else {
      groups.push({ site: e.site, status: e.status, detail: e.detail || "", endTs: e.ts, startTs: e.ts, count: 1, tabId: e.tabId || "", tabUrl: e.tabUrl || "" });
    }
  }
  return groups;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Tabs
function switchTab(tab) {
  $$(".feed-tab").forEach((b) => b.classList.remove("active"));
  $$(".feed-panel").forEach((el) => el.classList.remove("active"));
  const btn = $(`.feed-tab[data-tab="${tab}"]`);
  const panel = $(`#feed-${tab}`);
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");
  currentTab = tab;
  chrome.storage.local.set({ dashboardTab: tab });
}

$$(".feed-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

let tabRestored = false;
chrome.storage.local.get(["dashboardTab"], (data) => {
  if (data.dashboardTab && !tabRestored) {
    tabRestored = true;
    switchTab(data.dashboardTab);
  }
});

// Period toggle (analytics) — use delegation for reliability
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".period-btn");
  if (!btn) return;
  $$(".period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderAnalytics(btn.dataset.period);
});

// Clear feed
$("#dash-log-clear")?.addEventListener("click", () => {
  const cleared = logData.map((e) => ({ ...e, archivedAt: new Date().toISOString(), reason: "manual clear" }));
  const newArchive = [...cleared, ...archiveData].slice(0, 500);
  chrome.storage.local.set({ log: [], logArchive: newArchive });
  logData = [];
  archiveData = newArchive;
  chrome.storage.local.get(["targetUrls"], (data) => {
    renderTargets(data.targetUrls || []);
  });
  renderFeeds();
});

// Clear history
$("#clear-history")?.addEventListener("click", () => {
  chrome.storage.local.set({ logArchive: [] });
  archiveData = [];
  renderFeeds();
});

// Search
$("#search")?.addEventListener("input", (e) => {
  currentSearch = e.target.value;
  renderFeeds();
});

// Master toggle
function syncEngineState() {
  const el = $("#enabled");
  if (el) document.body.classList.toggle("engine-off", !el.checked);
}

$("#enabled")?.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: $("#enabled").checked });
  syncEngineState();
});

// Add channel
$("#channel-add")?.addEventListener("click", () => {
  const input = $("#channel-input");
  const val = input?.value.trim().replace(/^#/, "");
  if (!val) return;
  chrome.storage.local.get(["discordChannels"], (data) => {
    const arr = data.discordChannels || [];
    if (!arr.includes(val)) {
      arr.push(val);
      chrome.storage.local.set({ discordChannels: arr });
    }
  });
  input.value = "";
});
$("#channel-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#channel-add")?.click(); });

// Add keyword
$("#keyword-add")?.addEventListener("click", () => {
  const input = $("#keyword-input");
  const val = input?.value.trim().toLowerCase();
  if (!val) return;
  chrome.storage.local.get(["discordKeywords"], (data) => {
    const arr = data.discordKeywords || [];
    if (!arr.includes(val)) {
      arr.push(val);
      chrome.storage.local.set({ discordKeywords: arr });
    }
  });
  input.value = "";
});
$("#keyword-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#keyword-add")?.click(); });

// Add subreddit
$("#sub-add")?.addEventListener("click", () => {
  const input = $("#sub-input");
  const val = input?.value.trim().replace(/^r\//, "").replace(/^\/r\//, "");
  if (!val) return;
  chrome.storage.local.get(["redditSubs"], (data) => {
    const arr = data.redditSubs || [];
    if (!arr.includes(val)) {
      arr.push(val);
      chrome.storage.local.set({ redditSubs: arr });
    }
  });
  input.value = "";
});
$("#sub-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#sub-add")?.click(); });

// Add target URL
$("#dash-url-add")?.addEventListener("click", dashAddUrl);
$("#dash-url-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") dashAddUrl(); });

// Settings: Auto-Checkout toggle
$("#setting-auto-checkout")?.addEventListener("change", () => {
  saveSettingsField("autoCheckout", $("#setting-auto-checkout").checked);
});

// Settings: IMAP fields
["setting-imap-host", "setting-imap-port", "setting-imap-user", "setting-imap-pass"].forEach((id) => {
  $("#" + id)?.addEventListener("change", () => {
    saveSettingsField("imapConfig", collectImapConfig());
  });
});
$("#setting-imap-tls")?.addEventListener("change", () => {
  saveSettingsField("imapConfig", collectImapConfig());
});

// Settings: Proxy fields
["setting-proxy-host", "setting-proxy-port", "setting-proxy-user", "setting-proxy-pass"].forEach((id) => {
  $("#" + id)?.addEventListener("change", () => {
    saveSettingsField("proxyConfig", collectProxyConfig());
  });
});
$("#setting-proxy-enabled")?.addEventListener("change", () => {
  saveSettingsField("proxyConfig", collectProxyConfig());
});
$("#setting-proxy-type")?.addEventListener("change", () => {
  saveSettingsField("proxyConfig", collectProxyConfig());
});

load();
setInterval(() => {
  chrome.storage.local.get(["log", "logArchive", "targetUrls"], (data) => {
    logData = data.log || [];
    archiveData = data.logArchive || [];
    renderFeeds();
    renderAnalytics();
    renderTargets(data.targetUrls || []);
  });
}, 2000);

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log || changes.logArchive) {
    if (changes.log) logData = changes.log.newValue || [];
    if (changes.logArchive) archiveData = changes.logArchive.newValue || [];
    renderFeeds();
    chrome.storage.local.get(["targetUrls"], (data) => renderTargets(data.targetUrls || []));
  }
  if (changes.targetUrls) renderTargets(changes.targetUrls.newValue || []);
  if (changes.discordChannels) renderChannels(changes.discordChannels.newValue || []);
  if (changes.redditSubs) renderSubs(changes.redditSubs.newValue || []);
  if (changes.discordKeywords) renderKeywords(changes.discordKeywords.newValue || []);
  if (changes.enabled) {
    $("#enabled").checked = changes.enabled.newValue !== false;
    syncEngineState();
  }
  if (changes.autoCheckout || changes.imapConfig || changes.proxyConfig) {
    chrome.storage.local.get(["autoCheckout", "imapConfig", "proxyConfig"], (data) => {
      loadSettings(data);
    });
  }
});
