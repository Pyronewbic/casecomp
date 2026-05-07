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

let currentFilter = "all";
let currentSearch = "";
let logData = [];

function load() {
  chrome.storage.local.get(STORAGE_KEYS, (data) => {
    $("#enabled").checked = data.enabled !== false;
    logData = data.log || [];
    renderFeed();
    renderMonitors(data.sites || {}, data.monitorStatus || {});
    renderChannels(data.discordChannels || []);
    renderKeywords(data.discordKeywords || DEFAULT_KEYWORDS);
  });
}

function renderFeed() {
  const el = $("#feed");
  let entries = logData;

  if (currentFilter === "discord") {
    entries = entries.filter((e) => e.site === "discord");
  } else if (currentFilter === "sites") {
    entries = entries.filter((e) => e.site !== "discord" && e.status !== "new-listing" && e.site !== "system");
  } else if (currentFilter === "listings") {
    entries = entries.filter((e) => e.status === "new-listing");
  }

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

  el.scrollTop = 0;
  el.innerHTML = entries.slice(0, 200).map((e) => {
    const time = new Date(e.ts).toLocaleTimeString();
    const badgeClass = "badge-" + e.status.replace(/\s+/g, "-");
    return `<div class="feed-entry">
      <span class="feed-ts">${time}</span>
      <span class="feed-badge ${badgeClass}">${esc(e.status)}</span>
      <span class="feed-detail"><strong>${esc(e.site)}</strong> ${esc(e.detail || "")}</span>
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

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

$$(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderFeed();
  });
});

$("#search").addEventListener("input", (e) => {
  currentSearch = e.target.value;
  renderFeed();
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
    renderFeed();
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
