let ownerKey = "";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(path, opts = {}) {
  const headers = { Authorization: `Bearer ${ownerKey}`, ...opts.headers };
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`/admin${path}`, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showStatus(msg, type) {
  const el = $("#status");
  el.textContent = msg;
  el.className = type;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

function formatDate(d) {
  if (!d) return "never";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderKey(k) {
  const statusClass = k.active ? "status-active" : "status-revoked";
  const statusText = k.active ? "Active" : "Revoked";
  return `
    <div class="key-card" data-id="${k.id}">
      <div class="key-header">
        <div>
          <span class="key-label">${esc(k.label)}</span>
          <span class="key-prefix">${esc(k.keyPrefix)}</span>
        </div>
        <span class="${statusClass}">${statusText}</span>
      </div>
      <div class="key-meta">
        <div>Rate limit: <span class="value">${k.rateLimit}/min</span></div>
        <div>Requests: <span class="value">${(k.requestCount || 0).toLocaleString()}</span></div>
        <div>Last used: <span class="value">${formatDate(k.lastUsedAt)}</span></div>
        <div>Created: <span class="value">${formatDate(k.createdAt)}</span></div>
      </div>
      <div class="key-actions">
        <button class="secondary" onclick="rotateKey('${k.id}')">Rotate</button>
        <button class="secondary" onclick="toggleKey('${k.id}', ${!k.active})">${k.active ? "Revoke" : "Activate"}</button>
        <button class="danger" onclick="deleteKey('${k.id}')">Delete</button>
      </div>
    </div>
  `;
}

async function loadStats() {
  try {
    const [health, errors, { keys }] = await Promise.all([
      fetch("/api/health").then(r => r.json()),
      fetch(`/api/errors?limit=100`, { headers: { Authorization: `Bearer ${ownerKey}` } }).then(r => r.json()),
      api("/keys"),
    ]);

    const totalRequests = keys.reduce((s, k) => s + (k.requestCount || 0), 0);
    const activeKeys = keys.filter(k => k.active).length;
    const ebayUsage = health.ebay?.usageToday || 0;
    const ebayPct = Math.round((ebayUsage / (health.ebay?.dailyCap || 5000)) * 100);
    const fsLatency = health.firestore?.latencyMs || "—";
    const errorCount = errors.count || 0;

    $("#stats").innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Requests</div>
        <div class="stat-value">${totalRequests.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Keys</div>
        <div class="stat-value">${activeKeys}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">eBay Usage</div>
        <div class="stat-value ${ebayPct > 80 ? 'bad' : ebayPct > 50 ? 'warn' : 'ok'}">${ebayUsage} / ${health.ebay?.dailyCap || "?"}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Errors</div>
        <div class="stat-value ${errorCount > 0 ? 'bad' : 'ok'}">${errorCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Firestore</div>
        <div class="stat-value ${health.firestore?.connected ? 'ok' : 'bad'}">${fsLatency}ms</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value ok">${formatUptime(health.uptime)}</div>
      </div>
    `;

  } catch {}
}

function formatUptime(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function loadKeys() {
  try {
    const { keys } = await api("/keys");
    $("#key-list").innerHTML = keys.length
      ? keys.map(renderKey).join("")
      : '<div class="card" style="color: var(--muted); text-align: center;">No developer keys yet</div>';
  } catch (e) {
    showStatus(e.message, "error");
  }
}

$("#auth-btn").addEventListener("click", async () => {
  ownerKey = $("#owner-key").value.trim();
  if (!ownerKey) return;
  try {
    await api("/keys");
    $("#main").classList.remove("hidden");
    $("#owner-key").type = "text";
    $("#owner-key").value = "Authenticated";
    $("#owner-key").disabled = true;
    $("#auth-btn").disabled = true;
    $("#logout-btn").classList.remove("hidden");
    loadStats();
    loadKeys();
    loadErrors();
    window._refreshInterval = setInterval(() => { loadStats(); loadKeys(); loadErrors(); }, 30000);
  } catch (e) {
    showStatus("Authentication failed: " + e.message, "error");
    $("#main").classList.add("hidden");
  }
});

$("#logout-btn").addEventListener("click", () => {
  if (window._refreshInterval) clearInterval(window._refreshInterval);
  ownerKey = "";
  $("#main").classList.add("hidden");
  $("#logout-btn").classList.add("hidden");
  $("#owner-key").type = "password";
  $("#owner-key").value = "";
  $("#owner-key").disabled = false;
  $("#auth-btn").disabled = false;
  $("#key-list").innerHTML = "";
  showStatus("Logged out", "success");
});

$("#owner-key").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#auth-btn").click();
});

$("#create-btn").addEventListener("click", () => {
  $("#create-form").classList.toggle("hidden");
  $("#new-label").focus();
});

$("#submit-create").addEventListener("click", async () => {
  const label = $("#new-label").value.trim();
  const rateLimit = parseInt($("#new-rate").value) || 60;
  if (!label) return showStatus("Label is required", "error");
  try {
    const result = await api("/keys", {
      method: "POST",
      body: JSON.stringify({ label, rateLimit }),
    });
    $("#create-form").classList.add("hidden");
    $("#new-label").value = "";
    showStatus("Key created", "success");
    await loadKeys();
    const card = $(`.key-card[data-id="${result.id}"]`);
    if (card) {
      card.insertAdjacentHTML("beforeend", `<div class="new-key-display">New key (won't be shown again):<br><code>${esc(result.key)}</code> <button class="secondary" onclick="navigator.clipboard.writeText('${esc(result.key)}');this.textContent='Copied'">Copy</button></div>`);
    }
  } catch (e) {
    showStatus(e.message, "error");
  }
});

async function rotateKey(id) {
  if (!confirm("Rotate this key? The old key will stop working immediately.")) return;
  try {
    const result = await api(`/keys/${id}/rotate`, { method: "POST" });
    showStatus("Key rotated", "success");
    await loadKeys();
    const card = $(`.key-card[data-id="${id}"]`);
    if (card) {
      card.insertAdjacentHTML("beforeend", `<div class="new-key-display">New key (won't be shown again):<br><code>${esc(result.key)}</code> <button class="secondary" onclick="navigator.clipboard.writeText('${esc(result.key)}');this.textContent='Copied'">Copy</button></div>`);
    }
  } catch (e) {
    showStatus(e.message, "error");
  }
}

async function toggleKey(id, active) {
  try {
    await api(`/keys/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
    showStatus(active ? "Key activated" : "Key revoked", "success");
    loadKeys();
  } catch (e) {
    showStatus(e.message, "error");
  }
}

async function deleteKey(id) {
  if (!confirm("Delete this key permanently?")) return;
  try {
    await api(`/keys/${id}`, { method: "DELETE" });
    showStatus("Key deleted", "success");
    loadKeys();
  } catch (e) {
    showStatus(e.message, "error");
  }
}

async function loadErrors() {
  try {
    const typeFilter = document.getElementById("error-type-filter")?.value || "";
    const typeParam = typeFilter ? `&type=${encodeURIComponent(typeFilter)}` : "";
    const res = await fetch(`/api/errors?limit=20${typeParam}`, { headers: { Authorization: `Bearer ${ownerKey}` } });
    const { errors } = await res.json();
    if (!errors || !errors.length) {
      $("#error-list").innerHTML = '<div class="card"><div class="no-errors">No errors</div></div>';
      return;
    }
    $("#error-list").innerHTML = `<div class="card">${errors.map(e => `
      <div class="error-row">
        <span class="error-time">${formatDate(e.ts)}</span>
        <span class="error-type">${esc(e.type)}</span>
        <span class="error-msg">${esc(e.message)}</span>
        <span class="error-detail">${esc(e.detail)}</span>
        ${e.requestId ? `<span class="error-rid">${esc(e.requestId)}</span>` : ""}
      </div>
    `).join("")}</div>`;
  } catch (e) {
    $("#error-list").innerHTML = `<div class="card"><div class="no-errors" style="color: var(--red);">${esc(e.message)}</div></div>`;
  }
}

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
    tab.classList.add("active");
    const target = document.getElementById(`tab-${tab.dataset.tab}`);
    if (target) target.classList.remove("hidden");
    if (tab.dataset.tab === "analytics") loadAnalytics();
    if (tab.dataset.tab === "funnel") loadFunnel();
  });
});

function hBar(items, maxVal) {
  if (!items.length) return '<div class="no-errors">No data</div>';
  return items.map(([label, count]) => {
    const pct = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
    return `<div class="hbar-row">
      <span class="hbar-label">${esc(label)}</span>
      <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%"></div></div>
      <span class="hbar-count">${count.toLocaleString()}</span>
    </div>`;
  }).join("");
}

async function loadAnalytics() {
  const days = parseInt(document.getElementById("analytics-days")?.value) || 7;
  try {
    const res = await fetch(`/api/analytics?days=${days}`, { headers: { Authorization: `Bearer ${ownerKey}` } });
    const data = await res.json();

    const latClass = data.avgLatencyMs < 200 ? "ok" : data.avgLatencyMs < 500 ? "warn" : "bad";
    $("#analytics-stats").innerHTML = `
      <div class="stat-card"><div class="stat-label">Total Requests</div><div class="stat-value">${data.total.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Unique Users</div><div class="stat-value">${(data.uniqueUsers || 0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Avg Latency</div><div class="stat-value ${latClass}">${data.avgLatencyMs}ms</div></div>
    `;

    const daily = data.daily || [];
    if (daily.length) {
      const maxCount = Math.max(...daily.map(d => d.count));
      $("#analytics-daily").innerHTML = `<div class="bar-chart">${daily.map(d => {
        const h = maxCount > 0 ? Math.max(2, Math.round((d.count / maxCount) * 120)) : 2;
        const label = d.date.slice(5);
        return `<div class="bar-col"><div class="bar" style="height:${h}px" title="${d.date}: ${d.count} req, ${d.avgLatencyMs}ms avg"></div><div class="bar-date">${label}</div></div>`;
      }).join("")}</div>`;
    } else {
      $("#analytics-daily").innerHTML = '<div class="no-errors">No data yet</div>';
    }

    const tierEntries = Object.entries(data.byTier || {}).sort((a, b) => b[1] - a[1]);
    const tierMax = tierEntries.length ? tierEntries[0][1] : 0;
    $("#analytics-tier").innerHTML = hBar(tierEntries, tierMax);

    const statusEntries = Object.entries(data.byStatus || {}).sort((a, b) => b[1] - a[1]);
    const statusMax = statusEntries.length ? statusEntries[0][1] : 0;
    $("#analytics-status").innerHTML = hBar(statusEntries, statusMax);

    const pathEntries = Object.entries(data.byPath || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const pathMax = pathEntries.length ? pathEntries[0][1] : 0;
    $("#analytics-paths").innerHTML = hBar(pathEntries, pathMax);

    const queries = data.topQueries || [];
    if (queries.length) {
      $("#analytics-queries").innerHTML = `<table class="query-table">
        <tr><th>Query</th><th>Count</th></tr>
        ${queries.map(q => `<tr><td>${esc(q.query)}</td><td>${q.count}</td></tr>`).join("")}
      </table>`;
    } else {
      $("#analytics-queries").innerHTML = '<div class="no-errors">No queries yet</div>';
    }
  } catch (e) {
    $("#analytics-stats").innerHTML = `<div class="card"><div class="no-errors" style="color:var(--red)">${esc(e.message)}</div></div>`;
  }
}

async function loadFunnel() {
  try {
    const res = await fetch("/api/funnel", { headers: { Authorization: `Bearer ${ownerKey}` } });
    const data = await res.json();
    const stages = [
      { label: "Signups", key: "signup" },
      { label: "First Search", key: "firstSearch" },
      { label: "First Grade", key: "firstGrade" },
      { label: "First Portfolio Add", key: "firstPortfolioAdd" },
    ];
    const maxVal = data.signup || 1;
    $("#funnel-chart").innerHTML = stages.map((s, i) => {
      const count = data[s.key] || 0;
      const pct = Math.round((count / maxVal) * 100);
      const convLabel = i > 0 ? `${pct}%` : "";
      const opacity = 1 - i * 0.15;
      return `<div class="funnel-row">
        <span class="funnel-label">${s.label}</span>
        <div class="funnel-track"><div class="funnel-fill" style="width:${pct}%;opacity:${opacity}"></div></div>
        <span class="funnel-count">${count}</span>
        <span class="funnel-pct">${convLabel}</span>
      </div>`;
    }).join("");
  } catch (e) {
    $("#funnel-chart").innerHTML = `<div class="card"><div class="no-errors" style="color:var(--red)">${esc(e.message)}</div></div>`;
  }
}
