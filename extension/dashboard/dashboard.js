const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const STORAGE_KEYS = [
  "enabled", "sites", "log", "monitorStatus",
  "discordChannels", "discordKeywords",
];

const DEFAULT_KEYWORDS = [];

const MONITORS = [
  { id: "pokemon-center", label: "Pokemon Center US" },
  { id: "pokemon-center-jp", label: "Pokemon Center JP" },
  { id: "walmart", label: "Walmart" },
  { id: "costco", label: "Costco" },
  { id: "discord", label: "Discord" },
];

const WORKER_STATUSES = new Set([
  "detected", "joined", "waiting", "through", "captcha",
  "atc-success", "atc-failed", "target-opened",
]);

let currentTab = "workers";
let currentSearch = "";
let logData = [];

function isWorkerEntry(e) {
  return WORKER_STATUSES.has(e.status) || e.site === "system";
}

function load() {
  chrome.storage.local.get(STORAGE_KEYS, (data) => {
    $("#enabled").checked = data.enabled !== false;
    logData = data.log || [];
    renderFeeds();
    renderMonitors(data.sites || {});
    renderChannels(data.discordChannels || []);
    renderKeywords(data.discordKeywords || DEFAULT_KEYWORDS);
  });
}

function renderFeeds() {
  renderWorkerPanel($("#feed-workers"), logData.filter((e) => isWorkerEntry(e)));
  renderFlatPanel($("#feed-news"), logData.filter((e) => !isWorkerEntry(e)));
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
    el.innerHTML = '<div style="color:#555;padding:20px;text-align:center">No activity yet.</div>';
    return;
  }

  const bySite = new Map();
  for (const e of entries) {
    if (!bySite.has(e.site)) bySite.set(e.site, []);
    bySite.get(e.site).push(e);
  }

  el.scrollTop = 0;
  el.innerHTML = [...bySite.entries()].map(([site, siteEntries]) => {
    const grouped = groupConsecutive(siteEntries.slice(0, 100));
    const latest = grouped[0];
    const badgeClass = "badge-" + latest.status.replace(/\s+/g, "-");
    const countLabel = latest.count > 1 ? ` x${latest.count}` : "";
    const eta = extractEta(latest.detail);
    const etaHtml = eta ? `<span class="site-group-eta">ETA ${eta}</span>` : "";
    const rows = grouped.map((g) => {
      const bc = "badge-" + g.status.replace(/\s+/g, "-");
      const startTime = new Date(g.startTs).toLocaleTimeString();
      const endTime = new Date(g.endTs).toLocaleTimeString();
      const timeLabel = g.count > 1 ? `${endTime} – ${startTime}` : startTime;
      const cl = g.count > 1 ? ` <span class="feed-count">x${g.count}</span>` : "";
      return `<div class="feed-entry site-entry">
        <span class="feed-ts">${timeLabel}</span>
        <span class="feed-badge ${bc}">${esc(g.status)}${cl}</span>
        <span class="feed-detail">${esc(g.detail || "")}</span>
      </div>`;
    }).join("");
    return `<details class="site-group" open>
      <summary class="site-group-header">
        <span class="site-group-name">${esc(site)}</span>
        <span class="feed-badge ${badgeClass}">${esc(latest.status)}${countLabel}</span>
        ${etaHtml}
        <span class="site-group-detail">${esc(latest.detail || "")}</span>
      </summary>
      <div class="site-group-entries">${rows}</div>
    </details>`;
  }).join("");
}

function renderFlatPanel(el, entries) {
  entries = filterBySearch(entries);
  if (!entries.length) {
    el.innerHTML = '<div style="color:#555;padding:20px;text-align:center">No activity yet.</div>';
    return;
  }

  const grouped = groupConsecutive(entries.slice(0, 200));

  el.scrollTop = 0;
  el.innerHTML = grouped.map((g) => {
    const badgeClass = "badge-" + g.status.replace(/\s+/g, "-");
    const startTime = new Date(g.startTs).toLocaleTimeString();
    const endTime = new Date(g.endTs).toLocaleTimeString();
    const timeLabel = g.count > 1 ? `${endTime} – ${startTime}` : startTime;
    const countLabel = g.count > 1 ? ` <span class="feed-count">x${g.count}</span>` : "";
    return `<div class="feed-entry">
      <span class="feed-ts">${timeLabel}</span>
      <span class="feed-badge ${badgeClass}">${esc(g.status)}${countLabel}</span>
      <span class="feed-detail"><strong>${esc(g.site)}</strong> ${esc(g.detail || "")}</span>
    </div>`;
  }).join("");
}

const SITE_NAME_TO_ID = {
  "Pokémon Center": "pokemon-center",
  "Pokemon Center": "pokemon-center",
  "PC Japan": "pokemon-center-jp",
  "Walmart": "walmart",
  "Costco": "costco",
  "discord": "discord",
};

function getActiveFromLog() {
  const active = {};
  for (const e of logData) {
    const id = SITE_NAME_TO_ID[e.site] || e.site.toLowerCase().replace(/\s+/g, "-");
    if (!active[id]) active[id] = { ts: e.ts, status: e.status, eta: extractEta(e.detail) };
  }
  return active;
}

function renderMonitors(sites) {
  const el = $("#monitors");
  const now = Date.now();
  const lastActive = getActiveFromLog();
  el.innerHTML = MONITORS.map((m) => {
    const enabled = m.id === "discord" ? (sites.discord !== false) : (sites[m.id] !== false);
    const info = lastActive[m.id];
    const ago = info ? Math.round((now - new Date(info.ts).getTime()) / 1000) : null;
    let stateLabel, stateClass, etaLabel = "";
    if (!enabled) {
      stateLabel = "off";
      stateClass = "monitor-idle";
    } else if (ago !== null && ago < 300) {
      stateLabel = info.status;
      stateClass = "monitor-active";
      if (info.eta) etaLabel = `<span class="monitor-eta">${info.eta}</span>`;
    } else if (ago !== null) {
      const mins = Math.round(ago / 60);
      stateLabel = `${mins}m ago`;
      stateClass = "monitor-idle";
    } else {
      stateLabel = "idle";
      stateClass = "monitor-idle";
    }
    return `<div class="monitor-row">
      <span class="monitor-name">${m.label}</span>
      ${etaLabel}
      <span class="monitor-status ${stateClass}">${stateLabel}</span>
    </div>`;
  }).join("");
}

function renderChannels(channels) {
  const el = $("#discord-channels");
  el.innerHTML = channels.map((ch) =>
    `<span class="tag">#${esc(ch)}<button class="tag-remove" data-channel="${esc(ch)}">x</button></span>`
  ).join("");
  el.querySelectorAll(".tag-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = btn.dataset.channel;
      chrome.storage.local.get(["discordChannels"], (data) => {
        const arr = (data.discordChannels || []).filter((c) => c !== ch);
        chrome.storage.local.set({ discordChannels: arr });
      });
    });
  });
}

function renderKeywords(keywords) {
  const el = $("#keywords");
  el.innerHTML = keywords.map((kw) =>
    `<span class="tag">${esc(kw)}<button class="tag-remove" data-keyword="${esc(kw)}">x</button></span>`
  ).join("");
  el.querySelectorAll(".tag-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kw = btn.dataset.keyword;
      chrome.storage.local.get(["discordKeywords"], (data) => {
        const arr = (data.discordKeywords || []).filter((k) => k !== kw);
        chrome.storage.local.set({ discordKeywords: arr });
      });
    });
  });
}

function extractEta(detail) {
  if (!detail) return null;
  const m = detail.match(/ETA:\s*(\d[\d:]+)/);
  return m ? m[1] : null;
}

function groupConsecutive(entries) {
  const groups = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.site === e.site && last.status === e.status) {
      last.count++;
      last.startTs = e.ts;
    } else {
      groups.push({ site: e.site, status: e.status, detail: e.detail || "", endTs: e.ts, startTs: e.ts, count: 1 });
    }
  }
  return groups;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

$$(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    $$(".tab-content").forEach((el) => el.classList.remove("active"));
    $(`#feed-${currentTab}`).classList.add("active");
  });
});

$("#search").addEventListener("input", (e) => {
  currentSearch = e.target.value;
  renderFeeds();
});

$("#enabled").addEventListener("change", () => {
  chrome.storage.local.set({ enabled: $("#enabled").checked });
});

$("#channel-add").addEventListener("click", () => {
  const input = $("#channel-input");
  const val = input.value.trim().replace(/^#/, "");
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

$("#keyword-add").addEventListener("click", () => {
  const input = $("#keyword-input");
  const val = input.value.trim().toLowerCase();
  if (!val) return;
  chrome.storage.local.get(["discordKeywords"], (data) => {
    const arr = data.discordKeywords || DEFAULT_KEYWORDS;
    if (!arr.includes(val)) {
      arr.push(val);
      chrome.storage.local.set({ discordKeywords: arr });
    }
  });
  input.value = "";
});

load();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) {
    logData = changes.log.newValue || [];
    renderFeeds();
  }
  if (changes.monitorStatus || changes.sites) {
    chrome.storage.local.get(["sites"], (data) => {
      renderMonitors(data.sites || {});
    });
  }
  if (changes.discordChannels) renderChannels(changes.discordChannels.newValue || []);
  if (changes.discordKeywords) renderKeywords(changes.discordKeywords.newValue || DEFAULT_KEYWORDS);
  if (changes.enabled) $("#enabled").checked = changes.enabled.newValue !== false;
});
