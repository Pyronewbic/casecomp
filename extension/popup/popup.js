const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const SITE_ICONS = {
  "pokemon-center":    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></svg>',
  "pokemon-center-jp": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/><path d="M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" stroke-width="1" opacity=".4"/></svg>',
  "walmart":           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="22"/><line x1="2.9" y1="7" x2="7.2" y2="9.5"/><line x1="16.8" y1="14.5" x2="21.1" y2="17"/><line x1="2.9" y1="17" x2="7.2" y2="14.5"/><line x1="16.8" y1="9.5" x2="21.1" y2="7"/></svg>',
  "costco":            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/><line x1="12" y1="12" x2="12" y2="16"/></svg>',
  "pokemon":           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></svg>',
};

const SITE_NAME_TO_ID = {
  "Pokémon Center": "pokemon-center",
  "Pokemon Center": "pokemon-center",
  "PC Japan": "pokemon-center-jp",
  "Walmart": "walmart",
  "Costco": "costco",
  "discord": "discord",
  "system": "system",
};

const STATUS_TO_PILL = {
  through: "pill-through", detected: "pill-detected", joined: "pill-joined",
  waiting: "pill-waiting", captcha: "pill-captcha", "atc-success": "pill-through",
  "atc-failed": "pill-detected", "target-opened": "pill-detected",
  "discord-intel": "pill-intel", "new-listing": "pill-detected",
};

const STATUS_TO_SRC = {
  "pokemon-center": "PKMN-US", "pokemon-center-jp": "PKMN-JP",
  "walmart": "WMT", "costco": "CST", "discord": "DSC", "system": "SYS",
};

let logData = [];
let targetUrls = [];

function siteIdFromUrl(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("pokemoncenter.com") && !h.includes("-online")) return "pokemon-center";
    if (h.includes("pokemoncenter-online") || h.includes("pokemon.co.jp")) return "pokemon-center-jp";
    if (h.includes("walmart")) return "walmart";
    if (h.includes("costco")) return "costco";
    if (h.includes("pokemon.com")) return "pokemon";
  } catch {}
  return null;
}

function deriveSitesFromTargets(urls) {
  const sites = {};
  for (const u of urls) {
    const id = siteIdFromUrl(u.url);
    if (id && u.active) sites[id] = true;
  }
  return sites;
}

function load() {
  chrome.storage.local.get(
    ["enabled", "autoJoin", "autoAddToCart", "soundAlerts", "notifications", "targetUrls", "log"],
    (data) => {
      $("#enabled").checked = data.enabled !== false;
      $("#auto-join").checked = data.autoJoin !== false;
      $("#auto-atc").checked = data.autoAddToCart === true;
      $("#sound-alerts").checked = data.soundAlerts !== false;
      $("#notifications").checked = data.notifications !== false;
      logData = data.log || [];
      targetUrls = data.targetUrls || [];
      syncSitesFromTargets();
      renderTargets();
      renderLog();
      renderStats();
    },
  );
}

function syncSitesFromTargets() {
  const sites = deriveSitesFromTargets(targetUrls);
  chrome.storage.local.set({ sites });
}

function save() {
  chrome.storage.local.set({
    enabled: $("#enabled").checked,
    autoJoin: $("#auto-join").checked,
    autoAddToCart: $("#auto-atc").checked,
    soundAlerts: $("#sound-alerts").checked,
    notifications: $("#notifications").checked,
  });
}

function getLatestStatusForUrl(url) {
  for (const e of logData) {
    if (e.tabUrl === url && e.status !== "target-opened") return e;
  }
  const siteId = siteIdFromUrl(url);
  if (siteId) {
    for (const e of logData) {
      const id = SITE_NAME_TO_ID[e.site] || e.site.toLowerCase().replace(/\s+/g, "-");
      if (id === siteId && e.status !== "target-opened") return e;
    }
  }
  return null;
}

function renderTargets() {
  const el = $("#target-list");
  if (!el) return;
  const active = targetUrls.filter((u) => u.active).length;
  $("#targets-meta").textContent = `${active} active`;
  $("#stat-armed").textContent = active;
  $("#eyebrow-status").textContent = `Live · ${active} target${active !== 1 ? "s" : ""}`;

  if (!targetUrls.length) {
    el.innerHTML = '<div class="target-empty">No targets — paste a product URL above.</div>';
    return;
  }

  el.innerHTML = targetUrls.map((u) => {
    const siteId = siteIdFromUrl(u.url);
    const icon = siteId ? (SITE_ICONS[siteId] || "") : "";
    const label = u.label || slugFromUrl(u.url) || "target";
    const latest = getLatestStatusForUrl(u.url);

    let pillClass, pillLabel;
    if (!u.active) {
      pillClass = "pill-off";
      pillLabel = "paused";
    } else if (latest) {
      pillClass = STATUS_TO_PILL[latest.status] || "pill-armed";
      pillLabel = latest.status.replace(/-/g, " ");
    } else {
      pillClass = "pill-armed";
      pillLabel = "armed";
    }

    const stateClass = !u.active ? "" : (latest?.status === "captcha" ? "is-alert" : "is-on");

    const toggleLabel = u.active ? "armed" : "paused";
    return `<div class="target ${stateClass}" data-url="${escAttr(u.url)}">
      <div class="target-icon">${icon}</div>
      <div class="target-body">
        <div class="target-label">${esc(label)}</div>
        <div class="target-url">${esc(truncateUrl(u.url))}</div>
      </div>
      <button class="target-toggle ${u.active ? 'armed' : 'paused'}" title="Click to ${u.active ? 'pause' : 'activate'}">${esc(toggleLabel)}</button>
      <button class="target-remove" title="Remove">×</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".target-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".target").dataset.url;
      chrome.runtime.sendMessage({ type: "TOGGLE_TARGET_URL", url }, (res) => {
        if (res?.urls) { targetUrls = res.urls; syncSitesFromTargets(); renderTargets(); }
      });
    });
  });

  el.querySelectorAll(".target-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".target").dataset.url;
      chrome.runtime.sendMessage({ type: "REMOVE_TARGET_URL", url }, (res) => {
        if (res?.urls) { targetUrls = res.urls; syncSitesFromTargets(); renderTargets(); }
      });
    });
  });
}

function addUrl() {
  const input = $("#url-input");
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
    if (res?.urls) { targetUrls = res.urls; syncSitesFromTargets(); renderTargets(); }
    input.value = "";
  });
}

function extractEta(detail) {
  if (!detail) return null;
  const m = detail.match(/ETA:\s*(\d[\d:]+)/);
  return m ? m[1] : null;
}

function renderStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEntries = logData.filter((e) => new Date(e.ts).getTime() >= todayStart);
  $("#stat-today").textContent = todayEntries.length;

  let bestPos = null;
  let nextEta = null;
  for (const e of logData) {
    const posMatch = e.detail?.match(/pos(?:ition)?\s*(\d[\d,]*)/i);
    if (posMatch) {
      const p = parseInt(posMatch[1].replace(/,/g, ""), 10);
      if (bestPos === null || p < bestPos) bestPos = p;
    }
    if (!nextEta) {
      const eta = extractEta(e.detail);
      if (eta) nextEta = eta;
    }
  }
  $("#stat-best-pos").textContent = bestPos !== null ? bestPos.toLocaleString() : "—";
  $("#stat-next-eta").textContent = nextEta || "—";
}

function slugFromUrl(url) {
  if (!url) return "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last.replace(/[-_]/g, " ").replace(/\.\w+$/, "").slice(0, 30);
  } catch { return ""; }
}

function truncateUrl(url) {
  if (url.length <= 45) return url;
  try {
    const u = new URL(url);
    const path = u.pathname.length > 25 ? "..." + u.pathname.slice(-22) : u.pathname;
    return u.hostname + path;
  } catch { return url.slice(0, 42) + "..."; }
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

function renderLog() {
  const el = $("#log");
  if (!el) return;
  const WORKER_STATUSES = new Set(["detected", "joined", "waiting", "through", "captcha", "atc-success", "atc-failed", "target-opened"]);
  const workerLog = logData.filter((e) => WORKER_STATUSES.has(e.status) || e.site === "system");
  if (!workerLog.length) {
    el.innerHTML = '<div class="log-row" style="justify-content:center;color:var(--paper-dd);">No activity yet.</div>';
    return;
  }
  const grouped = groupConsecutive(workerLog.slice(0, 50));
  el.innerHTML = grouped.map((g) => {
    const siteId = SITE_NAME_TO_ID[g.site] || g.site.toLowerCase().replace(/\s+/g, "-");
    const src = STATUS_TO_SRC[siteId] || g.site;
    const pillClass = STATUS_TO_PILL[g.status] || "pill-idle";
    const time = new Date(g.endTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const countLabel = g.count > 1 ? ` x${g.count}` : "";
    const slug = slugFromUrl(g.tabUrl);
    const slugHtml = slug ? `<span class="slug">${esc(slug)}</span>` : "";
    return `<div class="log-row">
      <span class="log-ts">${time}</span>
      <span class="pill ${pillClass}">${esc(g.status.replace(/-/g, " "))}${countLabel}</span>
      <span class="log-msg"><span class="src">${esc(src)}</span>${slugHtml}${esc(g.detail || "")}</span>
    </div>`;
  }).join("");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Settings drawer
$("#open-settings")?.addEventListener("click", () => $("#settings-drawer")?.classList.add("open"));
$("#close-settings")?.addEventListener("click", () => $("#settings-drawer")?.classList.remove("open"));

// Settings checkboxes
["enabled", "auto-join", "auto-atc", "sound-alerts", "notifications"].forEach((id) => {
  $(`#${id}`)?.addEventListener("change", save);
});

// Dashboard
$("#open-dashboard")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});

// URL add
$("#url-add")?.addEventListener("click", addUrl);
$("#url-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") addUrl(); });

// Clear log
$("#log-clear")?.addEventListener("click", () => {
  chrome.storage.local.get(["logArchive"], (data) => {
    const cleared = logData.map((e) => ({ ...e, archivedAt: new Date().toISOString(), reason: "manual clear" }));
    const archive = [...cleared, ...(data.logArchive || [])].slice(0, 500);
    chrome.storage.local.set({ log: [], logArchive: archive });
    logData = [];
    renderLog();
    renderStats();
    renderTargets();
  });
});

load();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) {
    logData = changes.log.newValue || [];
    renderLog();
    renderStats();
    renderTargets();
  }
  if (changes.targetUrls) {
    targetUrls = changes.targetUrls.newValue || [];
    syncSitesFromTargets();
    renderTargets();
  }
});
