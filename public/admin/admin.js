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
    const res = await fetch(`/api/errors?limit=20`, { headers: { Authorization: `Bearer ${ownerKey}` } });
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
