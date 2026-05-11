const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const btn = document.getElementById("search-btn");
const resultsSection = document.getElementById("results");
const resultsHeader = document.getElementById("results-header");
const psaSignal = document.getElementById("psa-signal");
const activeList = document.getElementById("active-list");
const soldList = document.getElementById("sold-list");
const emptyState = document.getElementById("empty-state");
const alertSection = document.getElementById("alert-section");
const alertForm = document.getElementById("alert-form");
const alertMsg = document.getElementById("alert-msg");
const detailPanel = document.getElementById("detail-panel");

let currentQuery = "";
let currentSource = "";
let currentCondition = "";
let forceDemo = false;
let isDemo = false;
let allItems = [];
let allActive = [];
let allSold = [];
let activeSourceFilter = "all";

document.querySelectorAll(".hint").forEach(h => {
  h.addEventListener("click", () => {
    input.value = h.dataset.q;
    currentSource = h.dataset.source || "";
    currentCondition = h.dataset.condition || "";
    forceDemo = true;
    form.dispatchEvent(new Event("submit"));
  });
});

document.querySelectorAll(".list-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".list-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const show = tab.dataset.tab;
    activeList.classList.toggle("hidden", show !== "active");
    soldList.classList.toggle("hidden", show !== "sold");
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  currentQuery = q;
  await search(q, currentSource, currentCondition);
  currentSource = "";
  currentCondition = "";
  forceDemo = false;
});

async function search(q, source, condition) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Searching';
  emptyState.classList.add("hidden");
  resultsSection.classList.add("hidden");
  alertSection.classList.add("hidden");

  let url = `/api/search?q=${encodeURIComponent(q)}`;
  if (forceDemo) url += `&demo=true`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (condition) url += `&condition=${encodeURIComponent(condition)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Search failed (${res.status})`);
    }
    const data = await res.json();
    isDemo = !!data._demo;
    render(data);
  } catch (err) {
    resultsSection.classList.remove("hidden");
    resultsHeader.innerHTML = `<p style="color: var(--red);">${esc(err.message)}</p>`;
    activeList.innerHTML = "";
    soldList.innerHTML = "";
    psaSignal.classList.add("hidden");
    detailPanel.innerHTML = '<div class="detail-empty">Click a listing to inspect</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
}

function render(data) {
  resultsSection.classList.remove("hidden");

  const active = dedupeActive(data);
  const sold = data.sold || [];
  allItems = [...active, ...sold];
  const activeTotal = data.counts?.activeTotal || 0;
  const soldTotal = data.counts?.sold || 0;
  const hasGrades = active.some(i => i.grade && !i.grade.error);
  const hasSlabs = active.some(i => i.listingGradeLabel);
  const demoTag = data._demo ? '<span class="demo-badge">Sample Data</span>' : '';
  const gradeTag = hasGrades ? '<span class="demo-badge" style="margin-left: 6px;">AI Graded</span>'
    : hasSlabs ? '<span class="demo-badge" style="margin-left: 6px;">Slab</span>' : '';
  const noteHtml = data._demoNote ? `<p style="color: var(--muted); font-size: 13px; margin-top: 8px;">${esc(data._demoNote)}</p>` : '';
  const descHtml = data.listingDescription ? `<p class="meta" style="margin-top: 2px;">${esc(data.listingDescription)}</p>` : '';

  resultsHeader.innerHTML = `
    <h2>${esc(data.query)}${demoTag}${gradeTag}</h2>
    <p class="meta">${activeTotal} active &middot; ${soldTotal} sold &middot; ${esc(data.source || "ebay")}</p>
    ${descHtml}
    ${noteHtml}
  `;

  renderPsa(data.psaSignal);

  allActive = active;
  allSold = sold;
  activeSourceFilter = "all";

  const isMulti = data.source === "multi";
  const sources = isMulti ? detectSources(active, sold) : [];
  renderSourceFilters(sources);

  renderList(activeList, active);
  renderList(soldList, sold);

  const soldTab = document.querySelector('.list-tab[data-tab="sold"]');
  if (hasGrades && soldTotal === 0) {
    soldTab.classList.add("hidden");
  } else {
    soldTab.classList.remove("hidden");
  }

  // Reset tabs
  document.querySelectorAll(".list-tab").forEach(t => t.classList.remove("active"));
  document.querySelector('.list-tab[data-tab="active"]').classList.add("active");
  activeList.classList.remove("hidden");
  soldList.classList.add("hidden");

  // Auto-select first item
  detailPanel.innerHTML = '<div class="detail-empty">Click a listing to inspect</div>';
  if (active.length) selectItem(active[0].itemId);

  if (activeTotal > 0 || soldTotal > 0) {
    alertSection.classList.remove("hidden");
  }
}

function detectSources(active, sold) {
  const set = new Set();
  [...active, ...sold].forEach(i => {
    const s = itemSource(i.itemWebUrl);
    if (s) set.add(s);
  });
  return [...set].sort();
}

function renderSourceFilters(sources) {
  const existing = document.getElementById("source-filters");
  if (existing) existing.remove();
  if (!sources.length) return;

  const container = document.createElement("div");
  container.id = "source-filters";
  container.className = "source-filters";
  container.innerHTML = [
    `<button class="source-filter active" data-source="all">All</button>`,
    ...sources.map(s => `<button class="source-filter" data-source="${esc(s)}">${esc(s)}</button>`),
  ].join("");

  const tabsEl = document.querySelector(".list-tabs");
  tabsEl.parentNode.insertBefore(container, tabsEl.nextSibling);

  container.querySelectorAll(".source-filter").forEach(btn => {
    btn.addEventListener("click", () => {
      container.querySelectorAll(".source-filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeSourceFilter = btn.dataset.source;
      applySourceFilter();
    });
  });
}

function applySourceFilter() {
  const filterFn = activeSourceFilter === "all"
    ? () => true
    : (item) => itemSource(item.itemWebUrl) === activeSourceFilter;

  const filteredActive = allActive.filter(filterFn);
  const filteredSold = allSold.filter(filterFn);
  allItems = [...filteredActive, ...filteredSold];

  renderList(activeList, filteredActive);
  renderList(soldList, filteredSold);

  detailPanel.innerHTML = '<div class="detail-empty">Click a listing to inspect</div>';
  if (filteredActive.length) selectItem(filteredActive[0].itemId);
}

function dedupeActive(data) {
  const abc = data.activeByCountry || {};
  const seen = new Set();
  const items = [];
  for (const country of Object.keys(abc)) {
    for (const item of abc[country]) {
      if (!seen.has(item.itemId)) {
        seen.add(item.itemId);
        items.push(item);
      }
    }
  }
  return items.sort((a, b) => (a.totalCost || a.price) - (b.totalCost || b.price));
}

function renderPsa(psa) {
  if (!psa) { psaSignal.classList.add("hidden"); return; }
  psaSignal.classList.remove("hidden");
  const diffClass = psa.difficulty === "easy" ? "easy" : psa.difficulty === "hard" || psa.difficulty === "brutal" ? "hard" : "moderate";
  const tierLabel = psa.tier && psa.estCost ? `${psa.tier} · ${psa.estCost}` : esc(psa.estCost || "—");
  const reasonHtml = psa.tierReason ? `<div class="psa-tier-reason">${esc(psa.tierReason)}</div>` : "";

  psaSignal.innerHTML = `
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

function renderList(container, items) {
  if (!items.length) {
    container.innerHTML = '<div class="no-results">No listings found</div>';
    return;
  }
  container.innerHTML = items.map(item => {
    const price = formatPrice(item.price, item.priceCurrency);
    const imgSrc = item.imageUrl && !item.imageUrl.includes("placeholder") ? item.imageUrl : "";
    const imgHtml = imgSrc ? `<img class="thumb" src="${esc(imgSrc)}" alt="" loading="lazy">` : `<div class="thumb"></div>`;
    const condition = item.condition ? `<span class="condition">${esc(item.condition)}</span>` : "";
    const gradeChip = item.grade && !item.grade.error
      ? `<span class="grade-chip" style="color: ${gradeColor(item.grade.overall)}">${item.grade.overall.toFixed(1)}</span>`
      : item.listingGradeLabel
        ? `<span class="slab-chip">${esc(item.listingGradeLabel)}</span>`
        : "";
    const srcTag = sourceTag(item.itemWebUrl);

    return `
      <div class="listing-card" data-item-id="${esc(item.itemId)}">
        ${imgHtml}
        <div class="info">
          <div class="title">${esc(item.title)}</div>
          <div class="price-row">
            <span class="price">${price}</span>
            ${gradeChip}
            ${srcTag}
          </div>
          ${condition}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".listing-card").forEach(card => {
    card.addEventListener("click", () => selectItem(card.dataset.itemId));
  });
}

function selectItem(itemId) {
  document.querySelectorAll(".listing-card").forEach(c => c.classList.remove("selected"));
  const card = document.querySelector(`.listing-card[data-item-id="${itemId}"]`);
  if (card) card.classList.add("selected");

  const item = allItems.find(i => i.itemId === itemId);
  if (!item) return;

  const images = [item.imageUrl, ...((item.additionalImages || []).map(a => a.imageUrl || a))].filter(Boolean);

  const mainImg = images[0] ? `<img id="detail-main-img" class="detail-main-img" src="${esc(images[0])}" alt="">` : "";
  const thumbs = images.length > 1
    ? `<div class="detail-images">${images.map((url, i) => `<img src="${esc(url)}" alt="" class="${i === 0 ? "active-img" : ""}" data-url="${esc(url)}">`).join("")}</div>`
    : "";

  const grade = item.grade && !item.grade.error ? item.grade : null;
  const slabLabel = item.listingGradeLabel || null;
  const shippingText = item.shippingLabel && item.shippingLabel !== "—" && item.shippingLabel !== "Free"
    ? `+ ${item.shippingLabel} shipping` : item.shippingLabel === "Free" ? "Free shipping" : "";

  const gradeSection = grade ? `
    <div class="detail-summary-divider"></div>
    <div class="detail-summary-grade">
      <div class="detail-summary-grade-score" style="color: ${gradeColor(grade.overall)}">${grade.overall.toFixed(1)}</div>
      <div class="detail-summary-grade-meta">
        AI Pre-Grade
        <span>${Math.round(grade.confidence * 100)}% conf</span>
      </div>
    </div>
  ` : slabLabel ? `
    <div class="detail-summary-divider"></div>
    <div class="detail-summary-grade">
      <div class="detail-summary-slab-badge">${esc(slabLabel)}</div>
      <div class="detail-summary-grade-meta">Certified Grade</div>
    </div>
  ` : "";

  const summaryHtml = `
    <div class="detail-summary">
      <div>
        <div class="detail-summary-price">${formatPrice(item.totalCost || item.price, item.priceCurrency)}</div>
        ${shippingText ? `<div class="detail-summary-shipping">${esc(shippingText)}</div>` : ""}
      </div>
      ${gradeSection}
    </div>
  `;

  const fields = [];
  if (item.condition) fields.push({ label: "Condition", value: item.condition });
  if (item.soldDate || item.endedDate) fields.push({ label: "Sold", value: item.soldDate || item.endedDate });
  if (item.priceJPY) fields.push({ label: "JPY", value: `¥${item.priceJPY.toLocaleString()}` });
  if (item.totalCost && item.totalCost !== item.price) fields.push({ label: "Item Price", value: formatPrice(item.price, item.priceCurrency) });

  const fieldsHtml = fields.length ? `<div class="detail-grid">${fields.map(f => `
    <div class="detail-field"><div class="detail-label">${esc(f.label)}</div><div class="detail-value">${esc(f.value)}</div></div>
  `).join("")}</div>` : "";

  const gradeHtml = renderGradeDetail(grade);

  const isRealLink = item.itemWebUrl && !item.itemWebUrl.includes("placeholder") && !/\/(demo-|umb-[emy])/.test(item.itemWebUrl);
  const sourceName = item.itemWebUrl
    ? (item.itemWebUrl.includes("snkrdunk") ? "SNKRDUNK" : item.itemWebUrl.includes("ebay") ? "eBay" : item.itemWebUrl.includes("magi") ? "magi.camp" : item.itemWebUrl.includes("yahoo") ? "Yahoo Auctions" : "Source")
    : "";
  const linkHtml = isRealLink
    ? `<div class="detail-actions"><a href="${esc(item.itemWebUrl)}" target="_blank" rel="noopener">View on ${sourceName} &rarr;</a></div>`
    : "";

  const hasGrade = !!grade;
  const defaultTab = hasGrade ? "grade" : "prices";

  detailPanel.innerHTML = `
    <div class="detail-title">${esc(item.title)}</div>
    ${mainImg}
    ${thumbs}
    ${summaryHtml}
    <div class="detail-meta-row">
      ${fieldsHtml}
      <div id="card-identity" class="card-identity hidden"></div>
    </div>
    <div class="detail-tabs">
      ${hasGrade ? `<button class="detail-tab${defaultTab === "grade" ? " active" : ""}" data-dtab="grade">Grade</button>` : ""}
      <button class="detail-tab${defaultTab === "prices" ? " active" : ""}" data-dtab="prices">Prices</button>
    </div>
    <div class="detail-tab-panel${defaultTab === "grade" ? "" : " hidden"}" data-dtpanel="grade">
      ${gradeHtml}
    </div>
    <div class="detail-tab-panel${defaultTab === "prices" ? "" : " hidden"}" data-dtpanel="prices">
      <div id="arbitrage-container" class="arbitrage-container hidden"></div>
      <div id="price-chart-container" class="price-chart-container hidden">
        <div class="detail-grade-section-label">Price History</div>
        <canvas id="price-chart" height="120"></canvas>
        <div id="price-chart-stats" class="price-chart-stats"></div>
      </div>
    </div>
    ${linkHtml}
  `;

  detailPanel.querySelectorAll(".detail-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      detailPanel.querySelectorAll(".detail-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      detailPanel.querySelectorAll(".detail-tab-panel").forEach(p => p.classList.add("hidden"));
      const panel = detailPanel.querySelector(`[data-dtpanel="${tab.dataset.dtab}"]`);
      if (panel) panel.classList.remove("hidden");
    });
  });

  detailPanel.querySelectorAll(".detail-images img").forEach(img => {
    img.addEventListener("click", () => {
      const main = document.getElementById("detail-main-img");
      if (main) main.src = img.dataset.url;
      detailPanel.querySelectorAll(".detail-images img").forEach(i => i.classList.remove("active-img"));
      img.classList.add("active-img");
    });
  });

  loadCardIdentity(currentQuery);
  loadPriceChart(currentQuery);
  loadArbitrage(currentQuery);
}

async function loadCardIdentity(query) {
  const container = document.getElementById("card-identity");
  if (!container) return;
  try {
    const res = await fetch(`/api/card?q=${encodeURIComponent(query)}&demo=true`);
    if (!res.ok) return;
    const card = await res.json();
    if (!card.cardId) return;

    container.classList.remove("hidden");
    const names = card.names || {};
    const nameHtml = Object.entries(names).map(([lang, name]) =>
      `<span class="card-id-name"><span class="card-id-lang">${esc(lang)}</span> ${esc(name)}</span>`
    ).join("");

    const setName = card.setName || "";
    container.innerHTML = `
      <div class="card-id-row">
        <span class="card-id-badge">${esc(card.cardId)}</span>
        ${card.rarity ? `<span class="card-id-rarity">${esc(card.rarity)}</span>` : ""}
        ${setName ? `<span class="card-id-set">${esc(setName)}</span>` : ""}
      </div>
      ${nameHtml ? `<div class="card-id-names">${nameHtml}</div>` : ""}
    `;
  } catch {}
}

async function loadArbitrage(query) {
  const container = document.getElementById("arbitrage-container");
  if (!container) return;
  try {
    const res = await fetch(`/api/arbitrage?q=${encodeURIComponent(query)}&demo=true`);
    if (!res.ok) return;
    const data = await res.json();
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

async function loadPriceChart(query) {
  const container = document.getElementById("price-chart-container");
  const canvas = document.getElementById("price-chart");
  const statsEl = document.getElementById("price-chart-stats");
  if (!container || !canvas) return;

  try {
    const res = await fetch(`/api/price-history?q=${encodeURIComponent(query)}&days=90`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.history?.length) return;

    container.classList.remove("hidden");

    const points = data.history
      .filter(h => h.price > 0)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

    if (!points.length) return;

    drawPriceChart(canvas, points);

    if (data.stats) {
      statsEl.innerHTML = `
        <span>Low: <b>${formatPrice(data.stats.min, "USD")}</b></span>
        <span>Avg: <b>${formatPrice(data.stats.avg, "USD")}</b></span>
        <span>High: <b>${formatPrice(data.stats.max, "USD")}</b></span>
        <span>${data.stats.count} sales</span>
      `;
    }
  } catch {}
}

function drawPriceChart(canvas, points) {
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  const h = 120;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + "px";

  const prices = points.map(p => p.price);
  const min = Math.min(...prices) * 0.95;
  const max = Math.max(...prices) * 1.05;
  const range = max - min || 1;

  const pad = { top: 10, right: 10, bottom: 20, left: 50 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + (ch * i / 3);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    const val = max - (range * i / 3);
    ctx.fillStyle = "rgba(138,138,154,0.6)";
    ctx.font = "10px 'Space Grotesk', sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("$" + Math.round(val), pad.left - 6, y + 3);
  }

  // Line
  ctx.strokeStyle = "#d9b676";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = pad.left + (i / (points.length - 1 || 1)) * cw;
    const y = pad.top + ch - ((p.price - min) / range) * ch;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill under line
  const lastX = pad.left + cw;
  const lastY = pad.top + ch - ((points[points.length - 1].price - min) / range) * ch;
  ctx.lineTo(lastX, pad.top + ch);
  ctx.lineTo(pad.left, pad.top + ch);
  ctx.closePath();
  ctx.fillStyle = "rgba(217,182,118,0.08)";
  ctx.fill();

  // Dots
  ctx.fillStyle = "#d9b676";
  points.forEach((p, i) => {
    const x = pad.left + (i / (points.length - 1 || 1)) * cw;
    const y = pad.top + ch - ((p.price - min) / range) * ch;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
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
          return `
          <div class="grade-bar-item${b === lowest ? " grade-bar-lowest" : ""}">
            <div class="bar-label">${b.label}</div>
            <div class="grade-bar-track"><div class="grade-bar-fill" style="width: ${(b.value / 10) * 100}%; background: ${gradeColor(b.value)}"></div></div>
            <div class="bar-value" style="color: ${gradeColor(b.value)}">${b.value.toFixed(1)}</div>
            ${detail ? `<div class="bar-detail">${esc(detail)}</div>` : ""}
          </div>
        `;}).join("")}
      </div>
      ${grade.notes ? `<div class="detail-grade-notes">${esc(grade.notes)}</div>` : ""}
      ${grade.limitations ? `<div class="detail-grade-limitations">${esc(grade.limitations)}</div>` : ""}
    </div>
  `;
}

function itemSource(url) {
  if (!url) return "";
  if (url.includes("magi")) return "magi";
  if (url.includes("yahoo")) return "yahoo";
  if (url.includes("ebay")) return "eBay";
  if (url.includes("snkrdunk")) return "snkrdunk";
  return "";
}

function sourceTag(url) {
  const name = itemSource(url);
  return name ? `<span class="source-tag">${name}</span>` : "";
}

function gradeColor(v) {
  if (v >= 9.5) return "var(--green)";
  if (v >= 8.5) return "var(--gold)";
  return "var(--red)";
}

function formatPrice(price, currency) {
  if (price == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(price); }
  catch { return `$${price.toFixed(2)}`; }
}

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

alertForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("alert-email").value.trim();
  const price = parseFloat(document.getElementById("alert-price").value);
  if (!email || !price || !currentQuery) return;
  try {
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, targetPrice: price, query: currentQuery }),
    });
    alertMsg.textContent = res.ok ? "Alert set! We'll email you when the price drops." : "Saved — we'll notify you when alerts go live.";
    alertMsg.style.color = res.ok ? "var(--green)" : "var(--gold)";
  } catch {
    alertMsg.textContent = "Saved — we'll notify you when alerts go live.";
    alertMsg.style.color = "var(--gold)";
  }
  alertMsg.classList.remove("hidden");
});
