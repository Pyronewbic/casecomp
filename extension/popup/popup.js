const $ = (s) => document.querySelector(s);

const SITE_NAME_TO_ID = {
  "Pokémon Center": "pokemon-center",
  "Pokemon Center": "pokemon-center",
  "PC Japan": "pokemon-center-jp",
  "Walmart": "walmart",
  "Costco": "costco",
  "discord": "discord",
  "system": "system",
};

const SITE_IDS = [
  "pokemon-center", "pokemon-center-jp", "walmart", "costco", "discord",
];

let logData = [];

function load() {
  chrome.storage.local.get(
    ["enabled", "sites", "autoJoin", "autoAddToCart", "soundAlerts", "notifications", "targetUrls", "log"],
    (data) => {
      $("#enabled").checked = data.enabled !== false;
      $("#site-pokemon-center").checked = data.sites?.["pokemon-center"] !== false;
      $("#site-pokemon-center-jp").checked = data.sites?.["pokemon-center-jp"] !== false;
      $("#site-walmart").checked = data.sites?.walmart !== false;
      $("#site-costco").checked = data.sites?.costco !== false;
      $("#site-discord").checked = data.sites?.discord !== false;
      $("#auto-join").checked = data.autoJoin !== false;
      $("#auto-atc").checked = data.autoAddToCart === true;
      $("#sound-alerts").checked = data.soundAlerts !== false;
      $("#notifications").checked = data.notifications !== false;
      renderUrls(data.targetUrls || []);
      logData = data.log || [];
      renderLog();
      renderSiteStatuses();
    },
  );
}

function save() {
  chrome.storage.local.set({
    enabled: $("#enabled").checked,
    sites: {
      "pokemon-center": $("#site-pokemon-center").checked,
      "pokemon-center-jp": $("#site-pokemon-center-jp").checked,
      walmart: $("#site-walmart").checked,
      costco: $("#site-costco").checked,
      discord: $("#site-discord").checked,
    },
    autoJoin: $("#auto-join").checked,
    autoAddToCart: $("#auto-atc").checked,
    soundAlerts: $("#sound-alerts").checked,
    notifications: $("#notifications").checked,
  });
}

function getLatestStatusInfo(siteId) {
  for (const e of logData) {
    const id = SITE_NAME_TO_ID[e.site] || e.site.toLowerCase().replace(/\s+/g, "-");
    if (id === siteId && e.status !== "target-opened") {
      const eta = extractEta(e.detail);
      return { status: e.status, eta };
    }
  }
  return null;
}

function extractEta(detail) {
  if (!detail) return null;
  const m = detail.match(/ETA:\s*(\d[\d:]+)/);
  return m ? m[1] : null;
}

function renderSiteStatuses() {
  for (const id of SITE_IDS) {
    const badge = $(`#status-${id}`);
    if (!badge) continue;
    const info = getLatestStatusInfo(id);
    if (info) {
      const etaLabel = info.eta ? ` · ${info.eta}` : "";
      badge.textContent = info.status + etaLabel;
      badge.className = "site-status site-status-" + info.status.replace(/\s+/g, "-");
      badge.style.display = "";
    } else {
      badge.style.display = "none";
    }
  }
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

function renderLog() {
  const el = $("#log");
  if (!logData.length) {
    el.textContent = "No activity yet.";
    return;
  }
  const grouped = groupConsecutive(logData.slice(0, 100));
  el.innerHTML = grouped.map((g) => {
    const statusClass = g.status.replace(/\s+/g, "-");
    const startTime = new Date(g.startTs).toLocaleTimeString();
    const endTime = new Date(g.endTs).toLocaleTimeString();
    const timeLabel = g.count > 1 ? `${endTime} – ${startTime}` : startTime;
    const countLabel = g.count > 1 ? ` <span class="log-count">x${g.count}</span>` : "";
    return `<div class="log-entry"><span class="log-ts">${timeLabel}</span> <span class="log-site">${escapeHtml(g.site)}</span> <span class="log-status-${statusClass}">${escapeHtml(g.status)}${countLabel}</span> ${escapeHtml(g.detail || "")}</div>`;
  }).join("");
}

function renderUrls(urls) {
  const el = $("#url-list");
  if (!urls.length) {
    el.innerHTML = '<div style="color:#555;font-size:11px;padding:4px 0;">No target URLs.</div>';
    return;
  }
  el.innerHTML = urls.map((u) => {
    const cls = u.active ? "url-text" : "url-text inactive";
    const toggleLabel = u.active ? "pause" : "resume";
    const display = u.label || truncateUrl(u.url);
    return `<div class="url-entry" data-url="${escapeAttr(u.url)}">
      <span class="${cls}" title="${escapeAttr(u.url)}">${escapeHtml(display)}</span>
      <button class="url-toggle">${toggleLabel}</button>
      <button class="url-remove">x</button>
    </div>`;
  }).join("");

  el.querySelectorAll(".url-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".url-entry").dataset.url;
      chrome.runtime.sendMessage({ type: "TOGGLE_TARGET_URL", url }, (res) => {
        if (res?.urls) renderUrls(res.urls);
      });
    });
  });

  el.querySelectorAll(".url-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.closest(".url-entry").dataset.url;
      chrome.runtime.sendMessage({ type: "REMOVE_TARGET_URL", url }, (res) => {
        if (res?.urls) renderUrls(res.urls);
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
    const allowed = ["www.pokemoncenter.com", "pokemoncenter.com", "www.pokemoncenter-online.com", "pokemoncenter-online.com", "pokemoncenter.pokemon.co.jp", "www.walmart.com", "www.costco.com"];
    if (!allowed.some((h) => parsed.hostname === h || parsed.hostname.endsWith(".queue-it.net"))) {
      input.style.borderColor = "#ff5555";
      setTimeout(() => { input.style.borderColor = ""; }, 1500);
      return;
    }
  } catch {
    input.style.borderColor = "#ff5555";
    setTimeout(() => { input.style.borderColor = ""; }, 1500);
    return;
  }

  const label = extractLabel(raw);
  chrome.runtime.sendMessage({ type: "ADD_TARGET_URL", url: raw, label }, (res) => {
    if (res?.urls) renderUrls(res.urls);
    input.value = "";
  });
}

function extractLabel(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last.replace(/[-_]/g, " ").replace(/\.\w+$/, "").slice(0, 50) || u.hostname;
  } catch {
    return "";
  }
}

function truncateUrl(url) {
  if (url.length <= 45) return url;
  try {
    const u = new URL(url);
    const path = u.pathname.length > 25 ? "..." + u.pathname.slice(-22) : u.pathname;
    return u.hostname + path;
  } catch {
    return url.slice(0, 42) + "...";
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.querySelectorAll(".popup-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".popup-tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".popup-tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
  });
});

document.querySelectorAll("input[type='checkbox']").forEach((el) => el.addEventListener("change", save));

$("#open-dashboard").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});

$("#url-add").addEventListener("click", addUrl);
$("#url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addUrl(); });

$("#log-clear").addEventListener("click", () => {
  chrome.storage.local.set({ log: [] });
  logData = [];
  renderLog();
});

load();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) {
    logData = changes.log.newValue || [];
    renderLog();
    renderSiteStatuses();
  }
  if (changes.targetUrls) renderUrls(changes.targetUrls.newValue || []);
});
