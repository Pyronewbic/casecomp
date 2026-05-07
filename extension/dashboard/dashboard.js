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
    renderMonitors(data.sites || {}, data.monitorStatus || {});
    renderChannels(data.discordChannels || []);
    renderKeywords(data.discordKeywords || DEFAULT_KEYWORDS);
  });
}

function renderFeeds() {
  renderFeedPanel(
    $("#feed-workers"),
    logData.filter((e) => isWorkerEntry(e)),
  );
  renderFeedPanel(
    $("#feed-news"),
    logData.filter((e) => !isWorkerEntry(e)),
  );
}

function renderFeedPanel(el, entries) {
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    entries = entries.filter((e) =>
      (e.detail || "").toLowerCase().includes(q) ||
      e.site.toLowerCase().includes(q) ||
      e.status.toLowerCase().includes(q)
    );
  }

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

function renderMonitors(sites, status) {
  const el = $("#monitors");
  const now = Date.now();
  el.innerHTML = MONITORS.map((m) => {
    const enabled = m.id === "discord" ? (sites.discord !== false) : (sites[m.id] !== false);
    const lastSeen = status[m.id]?.lastSeen;
    const ago = lastSeen ? Math.round((now - new Date(lastSeen).getTime()) / 1000) : null;
    let stateLabel, stateClass;
    if (!enabled) {
      stateLabel = "off";
      stateClass = "monitor-idle";
    } else if (ago !== null && ago < 120) {
      stateLabel = "active";
      stateClass = "monitor-active";
    } else {
      stateLabel = "idle";
      stateClass = "monitor-idle";
    }
    return `<div class="monitor-row">
      <span class="monitor-name">${m.label}</span>
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
    chrome.storage.local.get(["sites", "monitorStatus"], (data) => {
      renderMonitors(data.sites || {}, data.monitorStatus || {});
    });
  }
  if (changes.discordChannels) renderChannels(changes.discordChannels.newValue || []);
  if (changes.discordKeywords) renderKeywords(changes.discordKeywords.newValue || DEFAULT_KEYWORDS);
  if (changes.enabled) $("#enabled").checked = changes.enabled.newValue !== false;
});
