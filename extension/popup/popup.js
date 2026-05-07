const $ = (s) => document.querySelector(s);

function load() {
  chrome.storage.local.get(
    ["enabled", "sites", "autoJoin", "autoAddToCart", "soundAlerts", "notifications", "targetUrls", "log"],
    (data) => {
      $("#enabled").checked = data.enabled !== false;
      $("#site-pokemon-center").checked = data.sites?.["pokemon-center"] !== false;
      $("#site-pokemon-center-jp").checked = data.sites?.["pokemon-center-jp"] !== false;
      $("#site-walmart").checked = data.sites?.walmart !== false;
      $("#site-costco").checked = data.sites?.costco !== false;
      $("#auto-join").checked = data.autoJoin !== false;
      $("#auto-atc").checked = data.autoAddToCart === true;
      $("#sound-alerts").checked = data.soundAlerts !== false;
      $("#notifications").checked = data.notifications !== false;
      renderUrls(data.targetUrls || []);
      renderLog(data.log || []);
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
    },
    autoJoin: $("#auto-join").checked,
    autoAddToCart: $("#auto-atc").checked,
    soundAlerts: $("#sound-alerts").checked,
    notifications: $("#notifications").checked,
  });
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

function renderLog(entries) {
  const el = $("#log");
  if (!entries.length) {
    el.textContent = "No activity yet.";
    return;
  }
  el.innerHTML = entries.slice(0, 50).map((e) => {
    const time = new Date(e.ts).toLocaleTimeString();
    const statusClass = e.status.replace(/\s+/g, "-");
    return `<div class="log-entry"><span class="log-ts">${time}</span><span class="log-site">${escapeHtml(e.site)}</span><span class="log-status-${statusClass}">${escapeHtml(e.status)}</span> ${escapeHtml(e.detail || "")}</div>`;
  }).join("");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.querySelectorAll("input[type='checkbox']").forEach((el) => el.addEventListener("change", save));

$("#url-add").addEventListener("click", addUrl);
$("#url-input").addEventListener("keydown", (e) => { if (e.key === "Enter") addUrl(); });

$("#log-clear").addEventListener("click", () => {
  chrome.storage.local.set({ log: [] });
  renderLog([]);
});

load();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.log) renderLog(changes.log.newValue || []);
  if (changes.targetUrls) renderUrls(changes.targetUrls.newValue || []);
});
