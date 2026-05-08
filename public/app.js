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
  const demoTag = data._demo ? '<span class="demo-badge">Demo Data</span>' : '';
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
  psaSignal.innerHTML = `
    <div class="psa-stat"><div class="label">Difficulty</div><div class="value ${diffClass}">${esc(psa.difficulty || "—")}</div></div>
    <div class="psa-stat"><div class="label">PSA 10 Chance</div><div class="value">${psa.gem10Pct != null ? psa.gem10Pct + "%" : "—"}</div></div>
    <div class="psa-stat"><div class="label">Total Pop</div><div class="value">${psa.totalPop != null ? psa.totalPop.toLocaleString() : "—"}</div></div>
    <div class="psa-stat"><div class="label">PSA 10</div><div class="value">${psa.pop10 != null ? psa.pop10.toLocaleString() : "—"}</div></div>
    <div class="psa-stat"><div class="label">PSA 9</div><div class="value">${psa.pop9 != null ? psa.pop9.toLocaleString() : "—"}</div></div>
    <div class="psa-stat"><div class="label">Grading Cost</div><div class="value">${esc(psa.estCost || "—")}</div></div>
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

  detailPanel.innerHTML = `
    <div class="detail-title">${esc(item.title)}</div>
    ${mainImg}
    ${thumbs}
    ${summaryHtml}
    ${fieldsHtml}
    ${gradeHtml}
    ${linkHtml}
  `;

  detailPanel.querySelectorAll(".detail-images img").forEach(img => {
    img.addEventListener("click", () => {
      const main = document.getElementById("detail-main-img");
      if (main) main.src = img.dataset.url;
      detailPanel.querySelectorAll(".detail-images img").forEach(i => i.classList.remove("active-img"));
      img.classList.add("active-img");
    });
  });
}

function renderGradeDetail(grade) {
  if (!grade) return "";

  const bars = [
    { label: "Centering", value: grade.centering },
    { label: "Corners", value: grade.corners },
    { label: "Edges", value: grade.edges },
    { label: "Surface", value: grade.surface },
  ];

  const lowest = bars.reduce((min, b) => b.value < min.value ? b : min, bars[0]);

  return `
    <div class="detail-grade">
      <div class="detail-grade-section-label">Grade Breakdown</div>
      <div class="detail-grade-bars">
        ${bars.map(b => `
          <div class="grade-bar-item${b === lowest ? " grade-bar-lowest" : ""}">
            <div class="bar-label">${b.label}</div>
            <div class="grade-bar-track"><div class="grade-bar-fill" style="width: ${(b.value / 10) * 100}%; background: ${gradeColor(b.value)}"></div></div>
            <div class="bar-value" style="color: ${gradeColor(b.value)}">${b.value.toFixed(1)}</div>
          </div>
        `).join("")}
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
