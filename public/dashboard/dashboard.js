let apiKey = "";
let demoOnly = false;
let currentQuery = "";
let allItems = [];
let allActive = [];
let allSold = [];
let activeSourceFilter = "all";
let currentIsDemo = false;

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function esc(s) { if (s == null) return ""; const d = document.createElement("div"); d.textContent = String(s); return d.innerHTML; }
function gradeColor(v) { return v >= 9.5 ? "var(--green)" : v >= 8.5 ? "var(--gold)" : "var(--red)"; }
function formatPrice(p, c) { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD" }).format(p); } catch { return `$${p.toFixed(2)}`; } }
function itemSource(url) { if (!url) return ""; if (url.includes("magi")) return "magi"; if (url.includes("yahoo")) return "yahoo"; if (url.includes("ebay")) return "eBay"; if (url.includes("snkrdunk")) return "snkrdunk"; return ""; }

async function api(path) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(path, { headers });
  return res.json();
}

// Auth
$("#auth-btn").addEventListener("click", async () => {
  apiKey = $("#api-key-input").value.trim();
  if (!apiKey) return;
  try {
    const d = await api("/api/health");
    if (d.status !== "ok") throw new Error("API unavailable");
    localStorage.setItem("cc_key", apiKey);
    showApp();
  } catch { alert("Invalid key or API unavailable"); }
});

$("#demo-btn").addEventListener("click", () => {
  demoOnly = true;
  apiKey = "";
  showApp();
});

$("#api-key-input").addEventListener("keydown", e => { if (e.key === "Enter") $("#auth-btn").click(); });

$("#logout-btn").addEventListener("click", () => {
  apiKey = "";
  demoOnly = false;
  localStorage.removeItem("cc_key");
  $("#auth-screen").classList.remove("hidden");
  $("#main").classList.add("hidden");
  $("#logout-btn").classList.add("hidden");
  $("#key-display").classList.add("hidden");
  $("#api-key-input").value = "";
});

function showApp() {
  $("#auth-screen").classList.add("hidden");
  $("#main").classList.remove("hidden");
  if (apiKey) {
    $("#key-display").textContent = apiKey.slice(0, 16) + "...";
    $("#key-display").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
  } else if (demoOnly) {
    $("#key-display").textContent = "Sample data mode";
    $("#key-display").classList.remove("hidden");
    $("#logout-btn").classList.remove("hidden");
  }
}

// Auto-login
const saved = localStorage.getItem("cc_key");
if (saved) { apiKey = saved; showApp(); }

// Navigation
$$(".nav-link").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    $$(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");
    const page = link.dataset.page;
    $("#page-search").classList.toggle("hidden", page !== "search");
    $("#page-history").classList.toggle("hidden", page !== "history");
  });
});

// Search
const searchForm = $("#search-form");
const searchInput = $("#search-input");
const searchBtn = $("#search-btn");

$$(".hint").forEach(h => {
  h.addEventListener("click", () => {
    searchInput.value = h.dataset.q;
    searchForm.dispatchEvent(new Event("submit"));
  });
});

searchForm.addEventListener("submit", async e => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  currentQuery = q;

  const hint = Array.from($$(".hint")).find(h => h.dataset.q === q);
  const isDemo = demoOnly || hint?.dataset.demo === "true";
  currentIsDemo = isDemo;
  const source = hint?.dataset.source || "";
  const condition = hint?.dataset.condition || "";

  let url = `/api/search?q=${encodeURIComponent(q)}`;
  if (isDemo) url += "&demo=true";
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (condition) url += `&condition=${encodeURIComponent(condition)}`;

  searchBtn.disabled = true;
  searchBtn.innerHTML = '<span class="spinner"></span>Searching';

  try {
    const data = await api(url);
    render(data);
  } catch (err) {
    $("#results-header").innerHTML = `<p style="color: var(--red);">${esc(err.message)}</p>`;
    $("#results").classList.remove("hidden");
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = "Search";
  }
});

function render(data) {
  $("#results").classList.remove("hidden");
  const active = dedupeActive(data);
  const sold = data.sold || [];
  allItems = [...active, ...sold];
  allActive = active;
  allSold = sold;
  activeSourceFilter = "all";

  const activeTotal = data.counts?.activeTotal || 0;
  const soldTotal = data.counts?.sold || 0;
  const hasGrades = active.some(i => i.grade && !i.grade.error);
  const hasSlabs = active.some(i => i.listingGradeLabel);
  const demoTag = data._demo ? '<span class="demo-badge">Sample Data</span>' : '';
  const gradeTag = hasGrades ? '<span class="demo-badge" style="margin-left:6px;">AI Graded</span>' : hasSlabs ? '<span class="demo-badge" style="margin-left:6px;">Slab</span>' : '';
  const descHtml = data.listingDescription ? `<p class="meta" style="margin-top:2px;">${esc(data.listingDescription)}</p>` : '';

  $("#results-header").innerHTML = `
    <h2>${esc(data.query)}${demoTag}${gradeTag}</h2>
    <p class="meta">${activeTotal} active &middot; ${soldTotal} sold &middot; ${esc(data.source || "ebay")}</p>
    ${descHtml}
  `;

  renderPsa(data.psaSignal);

  const isMulti = data.source === "multi";
  const sources = isMulti ? [...new Set([...active, ...sold].map(i => itemSource(i.itemWebUrl)).filter(Boolean))].sort() : [];
  renderSourceFilters(sources);

  renderList($("#active-list"), active);
  renderList($("#sold-list"), sold);

  $$(".list-tab").forEach(t => t.classList.remove("active"));
  $(".list-tab[data-tab='active']").classList.add("active");
  $("#active-list").classList.remove("hidden");
  $("#sold-list").classList.add("hidden");

  $("#detail-panel").innerHTML = '<div class="detail-empty">Click a listing to inspect</div>';
  if (active.length) selectItem(active[0].itemId);
}

function dedupeActive(data) {
  const abc = data.activeByCountry || {};
  const seen = new Set();
  const items = [];
  for (const country of Object.keys(abc)) {
    for (const item of abc[country]) {
      if (!seen.has(item.itemId)) { seen.add(item.itemId); items.push(item); }
    }
  }
  return items.sort((a, b) => (a.totalCost || a.price) - (b.totalCost || b.price));
}

$$(".list-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$(".list-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const show = tab.dataset.tab;
    $("#active-list").classList.toggle("hidden", show !== "active");
    $("#sold-list").classList.toggle("hidden", show !== "sold");
  });
});

function renderPsa(psa) {
  const el = $("#psa-signal");
  if (!psa) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const diffClass = psa.difficulty === "easy" ? "easy" : psa.difficulty === "hard" || psa.difficulty === "brutal" ? "hard" : "moderate";
  const tierLabel = psa.tier && psa.estCost ? `${psa.tier} · ${psa.estCost}` : esc(psa.estCost || "—");
  const reasonHtml = psa.tierReason ? `<div class="psa-tier-reason">${esc(psa.tierReason)}</div>` : "";
  el.innerHTML = `
    <div class="psa-stats-row">
      <div class="psa-stat"><div class="label">Difficulty</div><div class="value ${diffClass}">${esc(psa.difficulty || "—")}</div></div>
      <div class="psa-stat"><div class="label">PSA 10 Chance</div><div class="value">${psa.gem10Pct != null ? psa.gem10Pct + "%" : "—"}</div></div>
      <div class="psa-stat"><div class="label">Total Pop</div><div class="value">${psa.totalPop != null ? psa.totalPop.toLocaleString() : "—"}</div></div>
      <div class="psa-stat"><div class="label">PSA 10</div><div class="value">${psa.pop10 != null ? psa.pop10.toLocaleString() : "—"}</div></div>
      <div class="psa-stat"><div class="label">PSA 9</div><div class="value">${psa.pop9 != null ? psa.pop9.toLocaleString() : "—"}</div></div>
      <div class="psa-stat"><div class="label">Best Tier</div><div class="value">${tierLabel}</div></div>
    </div>
    ${reasonHtml}
  `;
}

function renderSourceFilters(sources) {
  const slot = $("#source-filters-slot");
  slot.innerHTML = "";
  if (!sources.length) return;
  const html = `<div class="source-filters">
    <button class="source-filter active" data-source="all">All</button>
    ${sources.map(s => `<button class="source-filter" data-source="${esc(s)}">${esc(s)}</button>`).join("")}
  </div>`;
  slot.innerHTML = html;
  slot.querySelectorAll(".source-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      slot.querySelectorAll(".source-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeSourceFilter = btn.dataset.source;
      const fn = activeSourceFilter === "all" ? () => true : i => itemSource(i.itemWebUrl) === activeSourceFilter;
      const fa = allActive.filter(fn), fs = allSold.filter(fn);
      allItems = [...fa, ...fs];
      renderList($("#active-list"), fa);
      renderList($("#sold-list"), fs);
      $("#detail-panel").innerHTML = '<div class="detail-empty">Click a listing to inspect</div>';
      if (fa.length) selectItem(fa[0].itemId);
    });
  });
}

function renderList(container, items) {
  if (!items.length) { container.innerHTML = '<div class="no-results">No listings found</div>'; return; }
  container.innerHTML = items.map(item => {
    const price = formatPrice(item.price, item.priceCurrency);
    const imgSrc = item.imageUrl && !item.imageUrl.includes("placeholder") ? item.imageUrl : "";
    const imgHtml = imgSrc ? `<img class="thumb" src="${esc(imgSrc)}" alt="" loading="lazy">` : `<div class="thumb"></div>`;
    const condition = item.condition ? `<span class="condition">${esc(item.condition)}</span>` : "";
    const gradeChip = item.grade && !item.grade.error
      ? `<span class="grade-chip" style="color:${gradeColor(item.grade.overall)}">${item.grade.overall.toFixed(1)}</span>`
      : item.listingGradeLabel ? `<span class="slab-chip">${esc(item.listingGradeLabel)}</span>` : "";
    const srcTag = itemSource(item.itemWebUrl) ? `<span class="source-tag">${itemSource(item.itemWebUrl)}</span>` : "";
    return `<div class="listing-card" data-item-id="${esc(item.itemId)}">${imgHtml}<div class="info"><div class="title">${esc(item.title)}</div><div class="price-row"><span class="price">${price}</span>${gradeChip}${srcTag}</div>${condition}</div></div>`;
  }).join("");
  container.querySelectorAll(".listing-card").forEach(card => {
    card.addEventListener("click", () => selectItem(card.dataset.itemId));
  });
}

function selectItem(itemId) {
  $$(".listing-card").forEach(c => c.classList.remove("selected"));
  const card = $(`.listing-card[data-item-id="${itemId}"]`);
  if (card) card.classList.add("selected");
  const item = allItems.find(i => i.itemId === itemId);
  if (!item) return;

  const images = [item.imageUrl, ...((item.additionalImages || []).map(a => a.imageUrl || a))].filter(Boolean);
  const mainImg = images[0] ? `<img id="detail-main-img" class="detail-main-img" src="${esc(images[0])}" alt="">` : "";
  const thumbs = images.length > 1
    ? `<div class="detail-images">${images.map((url, i) => `<img src="${esc(url)}" alt="" class="${i === 0 ? "active-img" : ""}" data-url="${esc(url)}">`).join("")}</div>` : "";

  const grade = item.grade && !item.grade.error ? item.grade : null;
  const slabLabel = item.listingGradeLabel || null;
  const shippingText = item.shippingLabel && item.shippingLabel !== "—" && item.shippingLabel !== "Free"
    ? `+ ${item.shippingLabel} shipping` : item.shippingLabel === "Free" ? "Free shipping" : "";

  const gradeSection = grade ? `
    <div class="detail-summary-divider"></div>
    <div class="detail-summary-grade">
      <div class="detail-summary-grade-score" style="color:${gradeColor(grade.overall)}">${grade.overall.toFixed(1)}</div>
      <div class="detail-summary-grade-meta">AI Pre-Grade<span>${Math.round(grade.confidence * 100)}% conf</span></div>
    </div>` : slabLabel ? `
    <div class="detail-summary-divider"></div>
    <div class="detail-summary-grade">
      <div class="detail-summary-slab-badge">${esc(slabLabel)}</div>
      <div class="detail-summary-grade-meta">Certified Grade</div>
    </div>` : "";

  const fields = [];
  if (item.condition) fields.push({ label: "Condition", value: item.condition });
  if (item.soldDate || item.endedDate) fields.push({ label: "Sold", value: item.soldDate || item.endedDate });
  if (item.priceJPY) fields.push({ label: "JPY", value: `¥${item.priceJPY.toLocaleString()}` });
  const fieldsHtml = fields.length ? `<div class="detail-grid">${fields.map(f => `<div><div class="detail-label">${esc(f.label)}</div><div class="detail-value">${esc(f.value)}</div></div>`).join("")}</div>` : "";

  const gradeHtml = renderGradeDetail(grade);

  const sourceName = item.itemWebUrl
    ? (item.itemWebUrl.includes("snkrdunk") ? "SNKRDUNK" : item.itemWebUrl.includes("ebay") ? "eBay" : item.itemWebUrl.includes("magi") ? "magi.camp" : item.itemWebUrl.includes("yahoo") ? "Yahoo Auctions" : "Source") : "";
  const isRealLink = item.itemWebUrl && !item.itemWebUrl.includes("placeholder");
  const linkHtml = isRealLink ? `<div class="detail-actions"><a href="${esc(item.itemWebUrl)}" target="_blank" rel="noopener">View on ${sourceName} &rarr;</a></div>` : "";

  $("#detail-panel").innerHTML = `
    <div class="detail-title">${esc(item.title)}</div>
    ${mainImg}${thumbs}
    <div class="detail-summary"><div><div class="detail-summary-price">${formatPrice(item.totalCost || item.price, item.priceCurrency)}</div>${shippingText ? `<div class="detail-summary-shipping">${esc(shippingText)}</div>` : ""}</div>${gradeSection}</div>
    ${fieldsHtml}${gradeHtml}
    <div id="arbitrage-container" class="arbitrage-container hidden"></div>
    <div id="price-chart-container" class="price-chart-container hidden"><div class="detail-grade-section-label">Price History</div><canvas id="price-chart" height="100"></canvas><div id="price-chart-stats" class="price-chart-stats"></div></div>
    ${linkHtml}
  `;

  $("#detail-panel").querySelectorAll(".detail-images img").forEach(img => {
    img.addEventListener("click", () => {
      const main = document.getElementById("detail-main-img");
      if (main) main.src = img.dataset.url;
      $("#detail-panel").querySelectorAll(".detail-images img").forEach(i => i.classList.remove("active-img"));
      img.classList.add("active-img");
    });
  });

  loadPriceChart(currentQuery);
  loadArbitrage(currentQuery);
}

function renderGradeDetail(grade) {
  if (!grade) return "";
  const sd = grade.subgradeDetails || {};
  const bars = [
    { label: "Centering", key: "centering", value: grade.centering },
    { label: "Corners", key: "corners", value: grade.corners },
    { label: "Edges", key: "edges", value: grade.edges },
    { label: "Surface", key: "surface", value: grade.surface },
  ];
  const lowest = bars.reduce((min, b) => b.value < min.value ? b : min, bars[0]);
  return `
    <div class="detail-grade">
      <div class="detail-grade-section-label">Grade Breakdown</div>
      <div class="detail-grade-bars">
        ${bars.map(b => {
          const detail = sd[b.key]?.detail || "";
          return `<div class="grade-bar-item${b === lowest ? " grade-bar-lowest" : ""}">
            <div class="bar-label">${b.label}</div>
            <div class="grade-bar-track"><div class="grade-bar-fill" style="width:${(b.value/10)*100}%;background:${gradeColor(b.value)}"></div></div>
            <div class="bar-value" style="color:${gradeColor(b.value)}">${b.value.toFixed(1)}</div>
            ${detail ? `<div class="bar-detail">${esc(detail)}</div>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${grade.notes ? `<div class="detail-grade-notes">${esc(grade.notes)}</div>` : ""}
      ${grade.limitations ? `<div class="detail-grade-limitations">${esc(grade.limitations)}</div>` : ""}
    </div>`;
}

// Price chart
async function loadPriceChart(query) {
  const container = document.getElementById("price-chart-container");
  if (!container) return;
  try {
    const data = await api(`/api/price-history?q=${encodeURIComponent(query)}&days=90`);
    if (!data.history?.length) return;
    container.classList.remove("hidden");
    const points = data.history.filter(h => h.price > 0).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    if (!points.length) return;
    drawChart(document.getElementById("price-chart"), points);
    if (data.stats) {
      document.getElementById("price-chart-stats").innerHTML = `
        <span>Low: <b>${formatPrice(data.stats.min, "USD")}</b></span>
        <span>Avg: <b>${formatPrice(data.stats.avg, "USD")}</b></span>
        <span>High: <b>${formatPrice(data.stats.max, "USD")}</b></span>
        <span>${data.stats.count} sales</span>`;
    }
  } catch {}
}

function drawChart(canvas, points, height = 100) {
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  canvas.width = w; canvas.height = height; canvas.style.width = w + "px";
  const prices = points.map(p => p.price);
  const min = Math.min(...prices) * 0.95, max = Math.max(...prices) * 1.05, range = max - min || 1;
  const pad = { top: 8, right: 8, bottom: 16, left: 44 };
  const cw = w - pad.left - pad.right, ch = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, w, height);
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (ch * i / 3);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.fillStyle = "rgba(138,138,154,0.6)"; ctx.font = "9px 'Space Grotesk',sans-serif"; ctx.textAlign = "right";
    ctx.fillText("$" + Math.round(max - (range * i / 3)), pad.left - 4, y + 3);
  }
  ctx.strokeStyle = "#d9b676"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
  points.forEach((p, i) => {
    const x = pad.left + (i / (points.length - 1 || 1)) * cw;
    const y = pad.top + ch - ((p.price - min) / range) * ch;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineTo(pad.left + cw, pad.top + ch); ctx.lineTo(pad.left, pad.top + ch); ctx.closePath();
  ctx.fillStyle = "rgba(217,182,118,0.08)"; ctx.fill();
  ctx.fillStyle = "#d9b676";
  points.forEach((p, i) => {
    const x = pad.left + (i / (points.length - 1 || 1)) * cw;
    const y = pad.top + ch - ((p.price - min) / range) * ch;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  });
}

// Arbitrage
async function loadArbitrage(query) {
  const container = document.getElementById("arbitrage-container");
  if (!container) return;
  try {
    const demo = currentIsDemo ? "&demo=true" : "";
    const data = await api(`/api/arbitrage?q=${encodeURIComponent(query)}${demo}`);
    const sources = data.sources || {};
    const names = Object.keys(sources);
    if (names.length < 2) return;

    container.classList.remove("hidden");
    const arb = data.arbitrage;

    container.innerHTML = `
      <div class="detail-grade-section-label">Cross-Source Prices</div>
      <div class="arbitrage-sources">
        ${names.sort((a, b) => sources[a].lowest - sources[b].lowest).map(s => {
          const d = sources[s];
          const isCheapest = arb && s === arb.cheapest.source;
          return `<div class="arb-source${isCheapest ? " arb-cheapest" : ""}">
            <div class="arb-source-name">${esc(s)}</div>
            <div class="arb-source-price">${formatPrice(d.lowest, d.currency)}</div>
            ${d.priceJPY ? `<div class="arb-source-jpy">¥${d.priceJPY.toLocaleString()}</div>` : ""}
            <div class="arb-source-count">${d.count} listing${d.count !== 1 ? "s" : ""}</div>
          </div>`;
        }).join("")}
      </div>
      ${arb ? `<div class="arb-summary">${esc(arb.summary)}</div>` : ""}
    `;
  } catch {}
}

// Price History page
$("#history-form").addEventListener("submit", async e => {
  e.preventDefault();
  const q = $("#history-input").value.trim();
  if (!q) return;
  try {
    const data = await api(`/api/price-history?q=${encodeURIComponent(q)}&days=90`);
    $("#history-chart-container").classList.remove("hidden");
    $("#history-title").textContent = data.query;
    if (data.history?.length) {
      const points = data.history.filter(h => h.price > 0).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
      drawChart(document.getElementById("history-chart"), points, 250);
      if (data.stats) {
        $("#history-stats").innerHTML = `
          <span>Low: <b>${formatPrice(data.stats.min, "USD")}</b></span>
          <span>Avg: <b>${formatPrice(data.stats.avg, "USD")}</b></span>
          <span>High: <b>${formatPrice(data.stats.max, "USD")}</b></span>
          <span>${data.stats.count} sales</span>`;
      }
      $("#history-table").innerHTML = `<table><thead><tr><th>Date</th><th>Price</th><th>Source</th><th>Grade</th></tr></thead><tbody>${
        data.history.map(h => `<tr><td>${h.soldDate || h.recordedAt?.split("T")[0] || "—"}</td><td>${formatPrice(h.price, h.currency)}</td><td>${esc(h.source)}</td><td>${esc(h.listingGradeLabel || "—")}</td></tr>`).join("")
      }</tbody></table>`;
    } else {
      $("#history-table").innerHTML = '<div class="no-results">No price history yet. Search for this card to start building history.</div>';
    }
  } catch (err) {
    $("#history-table").innerHTML = `<div class="no-results" style="color:var(--red);">${esc(err.message)}</div>`;
  }
});
