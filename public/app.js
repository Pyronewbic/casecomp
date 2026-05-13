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

// ── Autocomplete ──

const acDropdown = document.getElementById("autocomplete-dropdown");
const acPreview = document.getElementById("ac-preview");
let acDebounce = null;
let acIndex = -1;
let acResults = [];

input.addEventListener("input", () => {
  clearTimeout(acDebounce);
  const q = input.value.trim();
  if (q.length < 2) { hideAc(); return; }
  acDebounce = setTimeout(() => fetchAc(q), 150);
});

input.addEventListener("keydown", (e) => {
  if (acDropdown.classList.contains("hidden")) return;
  const items = acDropdown.querySelectorAll(".ac-item");
  if (e.key === "ArrowDown") { e.preventDefault(); acIndex = Math.min(acIndex + 1, items.length - 1); highlightAc(items); }
  else if (e.key === "ArrowUp") { e.preventDefault(); acIndex = Math.max(acIndex - 1, 0); highlightAc(items); }
  else if (e.key === "Enter") { e.preventDefault(); if (acIndex >= 0) selectAc(items[acIndex], acIndex); else if (items.length > 0) selectAc(items[0], 0); }
  else if (e.key === "Escape") { hideAc(); }
});

document.addEventListener("click", (e) => { if (!e.target.closest(".search-bar")) hideAc(); });

async function fetchAc(q) {
  try {
    const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}&limit=6`);
    if (!res.ok) { hideAc(); return; }
    const data = await res.json();
    renderAc(data.results || []);
  } catch { hideAc(); }
}

function showAcPreview(idx) {
  const c = acResults[idx];
  if (!c || !c.imageUrl) { acPreview.classList.add("hidden"); return; }
  const highRes = c.imageUrl.replace("/low.png", "/high.png");
  acPreview.innerHTML = `<img src="${highRes}" alt="${c.name}"><div class="ac-preview-name">${c.name}${c.nameJa && c.nameJa !== c.name ? ' <span style="opacity:0.5">' + c.nameJa + '</span>' : ''}</div><div class="ac-preview-set">${c.setName || c.setCode || ""} / ${c.localId || ""}</div>`;
  acPreview.classList.remove("hidden");
}

function renderAc(results) {
  if (!results.length) { hideAc(); return; }
  acIndex = -1;
  acResults = results;
  acDropdown.innerHTML = results.map(c => {
    const img = c.imageUrl
      ? `<img class="ac-img" src="${c.imageUrl}" alt="" loading="lazy">`
      : `<div class="ac-img-placeholder">?</div>`;
    const name = c.nameJa && c.nameJa !== c.name ? `${c.name} <span style="opacity:0.5">${c.nameJa}</span>` : c.name;
    const meta = [c.setName || c.setCode, c.localId].filter(Boolean).join(" / ");
    const cardId = c.cardId ? `<span class="ac-cardid">${c.cardId}</span>` : "";
    const cardNum = c.cardId ? c.cardId.split("/")[1]?.replace("-", "/") : "";
    const searchQuery = cardNum
      ? `${c.name} ${cardNum} ${c.setName || ""}`.trim()
      : c.name;
    return `<div class="ac-item" data-query="${searchQuery}" data-name="${c.name}">${img}<div class="ac-info"><span class="ac-name">${name}</span><span class="ac-meta">${meta}</span></div>${cardId}</div>`;
  }).join("");
  acDropdown.classList.remove("hidden");
  acDropdown.querySelectorAll(".ac-item").forEach((el, i) => {
    el.addEventListener("mousedown", (e) => { e.preventDefault(); selectAc(el, i); });
    el.addEventListener("mouseenter", () => { acIndex = i; highlightAc(acDropdown.querySelectorAll(".ac-item")); showAcPreview(i); });
  });
}

function highlightAc(items) {
  items.forEach((el, i) => el.classList.toggle("ac-active", i === acIndex));
  if (items[acIndex]) { items[acIndex].scrollIntoView({ block: "nearest" }); showAcPreview(acIndex); }
}

function selectAc(el, idx) {
  const q = el.dataset.query.trim();
  input.value = q;
  const card = acResults[idx ?? acIndex] || {};
  hideAc();
  currentQuery = q;

  if (card.cardId) {
    searchByCardId(card);
  } else {
    const lang = card.nameJa ? "jp" : "";
    let url = `/api/search?q=${encodeURIComponent(q)}`;
    if (forceDemo) url += `&demo=true`;
    if (lang) url += `&lang=${lang}`;
    searchUrl(url, q);
  }
  currentSource = "";
  currentCondition = "";
  forceDemo = false;
}

async function searchByCardId(card) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Searching';
  emptyState.classList.add("hidden");
  resultsSection.classList.add("hidden");
  alertSection.classList.add("hidden");

  const [setCode, number] = card.cardId.split("/");
  const shareUrl = `/api/card/share/${setCode}/${number}`;
  const searchName = card.name || card.nameJa || "";

  try {
    const shareRes = await fetch(shareUrl);
    if (shareRes.ok) {
      const shareData = await shareRes.json();
      if (shareData.psaSignal) currentPsaSignal = shareData.psaSignal;

      const searchQ = shareData.searchQuery || `${searchName} ${number.replace("-", "/")}`;
      const searchRes = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}&demo=true`);
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.psaSignal == null && shareData.psaSignal) data.psaSignal = shareData.psaSignal;
        isDemo = !!data._demo;
        render(data);
        btn.disabled = false;
        btn.textContent = "Search";

        fetchLiveSources(searchName, card).catch(() => {});
        return;
      }
    }
  } catch {}

  const lang = card.nameJa ? "jp" : "";
  let url = `/api/search?q=${encodeURIComponent(input.value.trim())}&grade=true`;
  if (lang) url += `&lang=${lang}`;
  searchUrl(url, input.value.trim());
}

async function fetchLiveSources(name, card) {
  const q = `${name} ${card.cardId.split("/")[1]?.replace("-", "/") || ""}`.trim();
  const sources = ["magi", "yahoo", "snkrdunk"];
  const results = await Promise.allSettled(
    sources.map(s => fetch(`/api/search?q=${encodeURIComponent(q)}&source=${s}&grade=true`).then(r => r.json()))
  );
  let added = 0;
  for (let i = 0; i < sources.length; i++) {
    if (results[i].status !== "fulfilled") continue;
    const data = results[i].value;
    const items = Object.values(data.activeByCountry || {}).flat();
    if (items.length) {
      allActive.push(...items);
      added += items.length;
    }
    if (data.sold?.length) allSold.push(...data.sold);
  }
  if (added > 0) {
    renderList(sortItems(allActive, currentSort), "active");
    document.querySelector('.list-tab[data-tab="active"]').textContent = `Active (${allActive.length})`;
    document.querySelector('.list-tab[data-tab="sold"]').textContent = `Sold (${allSold.length})`;
  }
}

function hideAc() { acDropdown.classList.add("hidden"); acPreview.classList.add("hidden"); acDropdown.innerHTML = ""; acIndex = -1; acResults = []; }
let allActive = [];
let allSold = [];
let activeSourceFilter = "all";
let currentSort = "price-asc";
let currentPsaSignal = null;
let currentMagiMarket = null;
let pendingChartPoints = null;

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

document.getElementById("sort-select").addEventListener("change", (e) => {
  currentSort = e.target.value;
  applySourceFilter();
});

// ── Search filters ──

let currentFormat = "raw";
let activeSources = new Set(["ebay", "magi", "yahoo", "snkrdunk"]);
let currentFilterCondition = "";

document.querySelectorAll('.filter-pill[data-format]').forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll('.filter-pill[data-format]').forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFormat = btn.dataset.format;
    document.getElementById("slab-options").classList.toggle("hidden", currentFormat !== "slab");
    triggerFilterSearch();
  });
});

const allSources = ["ebay", "magi", "yahoo", "snkrdunk"];
const allPill = document.querySelector('.source-pill[data-source="all"]');

function syncSourcePills() {
  const allActive = allSources.every(s => activeSources.has(s));
  allPill.classList.toggle("active", allActive);
  document.querySelectorAll('.source-pill:not([data-source="all"])').forEach(b => {
    b.classList.toggle("active", activeSources.has(b.dataset.source));
  });
}

allPill.addEventListener("click", () => {
  const allActive = allSources.every(s => activeSources.has(s));
  if (allActive) return;
  activeSources = new Set(allSources);
  syncSourcePills();
  triggerFilterSearch();
});

document.querySelectorAll('.source-pill:not([data-source="all"])').forEach(btn => {
  btn.addEventListener("click", () => {
    const src = btn.dataset.source;
    if (activeSources.has(src)) {
      if (activeSources.size > 1) activeSources.delete(src);
    } else {
      activeSources.add(src);
    }
    syncSourcePills();
    triggerFilterSearch();
  });
});

document.getElementById("condition-filter").addEventListener("change", (e) => {
  currentFilterCondition = e.target.value;
  triggerFilterSearch();
});

document.getElementById("slab-provider").addEventListener("change", () => triggerFilterSearch());
document.getElementById("slab-grade").addEventListener("change", () => triggerFilterSearch());

function triggerFilterSearch() {
  const q = currentQuery || input.value.trim();
  if (!q) return;
  const sources = [...activeSources];
  if (sources.length === 1) {
    let url = `/api/search?q=${encodeURIComponent(q)}&source=${sources[0]}`;
    if (currentFormat === "slab") {
      url += `&format=slab&slab_provider=${document.getElementById("slab-provider").value}&slab_grade=${document.getElementById("slab-grade").value}`;
    }
    if (currentFilterCondition) url += `&condition=${currentFilterCondition}`;
    url += "&grade=true";
    searchUrl(url, q);
  } else if (sources.length === allSources.length) {
    let url = `/api/search?q=${encodeURIComponent(q)}`;
    if (currentFormat === "slab") {
      url += `&format=slab&slab_provider=${document.getElementById("slab-provider").value}&slab_grade=${document.getElementById("slab-grade").value}`;
    }
    if (currentFilterCondition) url += `&condition=${currentFilterCondition}`;
    url += "&grade=true";
    searchUrl(url, q);
  } else {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Searching';
    emptyState.classList.add("hidden");
    resultsSection.classList.add("hidden");
    const cond = currentFilterCondition ? `&condition=${currentFilterCondition}` : "";
    const fmt = currentFormat === "slab" ? `&format=slab&slab_provider=${document.getElementById("slab-provider").value}&slab_grade=${document.getElementById("slab-grade").value}` : "";
    Promise.allSettled(
      sources.map(s => fetch(`/api/search?q=${encodeURIComponent(q)}&source=${s}${cond}${fmt}&grade=true`).then(r => r.json()))
    ).then(results => {
      const merged = { query: q, source: "multi", listingFormat: currentFormat, activeByCountry: { US: [] }, sold: [], psaSignal: null, counts: { activeTotal: 0, sold: 0 } };
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const d = r.value;
        const items = Object.values(d.activeByCountry || {}).flat();
        merged.activeByCountry.US.push(...items);
        if (d.sold) merged.sold.push(...d.sold);
        if (d.psaSignal && !merged.psaSignal) merged.psaSignal = d.psaSignal;
      }
      merged.counts.activeTotal = merged.activeByCountry.US.length;
      merged.counts.sold = merged.sold.length;
      render(merged);
      btn.disabled = false;
      btn.textContent = "Search";
    });
  }
}

function sortItems(items) {
  const sorted = [...items];
  if (currentSort === "price-desc") {
    sorted.sort((a, b) => (b.totalCost || b.price) - (a.totalCost || a.price));
  } else {
    sorted.sort((a, b) => (a.totalCost || a.price) - (b.totalCost || b.price));
  }
  return sorted;
}

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
  let url = `/api/search?q=${encodeURIComponent(q)}`;
  if (forceDemo) url += `&demo=true`;
  if (source) url += `&source=${encodeURIComponent(source)}`;
  if (condition) url += `&condition=${encodeURIComponent(condition)}`;
  return searchUrl(url, q);
}

async function searchUrl(url, q) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Searching';
  emptyState.classList.add("hidden");
  resultsSection.classList.add("hidden");
  alertSection.classList.add("hidden");

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

  currentPsaSignal = data.psaSignal || null;
  if (data.psaSignal) {
    renderPsa(data.psaSignal);
  } else {
    psaSignal.classList.add("hidden");
    const psaQuery = data.query.replace(/\s+\d+\/\d+.*$/, "").trim() || data.query;
    fetchPsaLazy(psaQuery);
  }

  allActive = active;
  allSold = sold;
  activeSourceFilter = "all";
  currentSort = "price-asc";
  document.getElementById("sort-select").value = "price-asc";

  const isMulti = data.source === "multi";
  const sources = isMulti ? detectSources(active, sold) : [];
  renderSourceFilters(sources);

  renderList(activeList, sortItems(active));
  renderList(soldList, sortItems(sold));

  const activeTab = document.querySelector('.list-tab[data-tab="active"]');
  const soldTab = document.querySelector('.list-tab[data-tab="sold"]');
  activeTab.textContent = `Active (${active.length})`;
  soldTab.textContent = `Sold (${sold.length})`;

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

  const filteredActive = sortItems(allActive.filter(filterFn));
  const filteredSold = sortItems(allSold.filter(filterFn));
  allItems = [...filteredActive, ...filteredSold];

  renderList(activeList, filteredActive);
  renderList(soldList, filteredSold);

  document.querySelector('.list-tab[data-tab="active"]').textContent = `Active (${filteredActive.length})`;
  document.querySelector('.list-tab[data-tab="sold"]').textContent = `Sold (${filteredSold.length})`;

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

async function fetchPsaLazy(query) {
  try {
    const res = await fetch(`/api/psa?q=${encodeURIComponent(query)}&demo=true`);
    if (!res.ok) return;
    const data = await res.json();
    const psa = data.signal || data;
    if (psa && psa.totalPop != null && currentQuery === query) {
      currentPsaSignal = psa;
      renderPsa(psa);
    }
  } catch {}
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

    let displayCond = item.condition || "";
    if (!item.listingGradeLabel && item.detectedCondition) {
      displayCond = item.detectedCondition;
    } else if (displayCond === "Ungraded" || displayCond === "ungraded") {
      displayCond = item.detectedCondition || "";
    }
    const useBadge = !item.condition && item.detectedCondition;
    const conditionHtml = displayCond
      ? `<span class="${useBadge ? "condition-badge" : "condition"}">${esc(displayCond)}</span>`
      : "";

    const shippingHtml = item.shippingLabel === "Free" || item.shippingLabel === "free"
      ? '<span class="shipping shipping-free">Free shipping</span>'
      : item.shippingLabel && item.shippingLabel !== "—"
        ? `<span class="shipping">+ ${esc(item.shippingLabel)}</span>`
        : "";

    const outlierHtml = item._priceOutlier ? '<span class="price-outlier">Price outlier</span>' : "";

    const hasMultiplePhotos = item.additionalImages?.length > 0;
    const gradeChip = item.grade && !item.grade.error
      ? `<span class="grade-chip" style="color: ${gradeColor(item.grade.overall)}">${item.grade.overall.toFixed(1)}</span>`
      : item.listingGradeLabel
        ? `<span class="slab-chip">${esc(item.listingGradeLabel)}</span>`
        : `<span class="no-grade-chip" title="${hasMultiplePhotos ? "Not graded" : "Single photo"}">—</span>`;
    const srcTag = sourceTag(item.itemWebUrl);

    return `
      <div class="listing-card" data-item-id="${esc(item.itemId)}">
        ${imgHtml}
        <div class="info">
          <div class="title">${esc(item.title)}</div>
          <div class="price-row">
            <span class="price">${price}</span>
            ${gradeChip}
            ${shippingHtml}
            ${srcTag}
          </div>
          ${conditionHtml}
          ${outlierHtml}
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
  const slabLabel = item.listingGradeLabel && item.listingGradeLabel !== "Ungraded" ? item.listingGradeLabel : null;
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
  if (slabLabel) {
    fields.push({ label: "Condition", value: `<span class="graded-badge">Graded</span>`, raw: true });
  } else {
    const condVal = (item.condition === "Ungraded" || item.condition === "ungraded")
      ? (item.detectedCondition || "")
      : (item.detectedCondition || item.condition || "");
    if (condVal) fields.push({ label: "Condition", value: condVal });
  }
  if (item.soldDate || item.endedDate) fields.push({ label: "Sold", value: item.soldDate || item.endedDate });
  if (item.priceJPY) fields.push({ label: "Price (JPY)", value: `¥${item.priceJPY.toLocaleString()}` });
  if (item.totalCost && item.totalCost !== item.price) fields.push({ label: "Item Price", value: formatPrice(item.price, item.priceCurrency) });

  const fieldsHtml = fields.length ? `<div class="detail-grid">${fields.map(f => `
    <div class="detail-field"><div class="detail-label">${esc(f.label)}</div><div class="detail-value">${f.raw ? f.value : esc(f.value)}</div></div>
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
    </div>
    <div id="card-identity" class="card-identity hidden"></div>
    <div class="detail-tabs">
      ${hasGrade ? `<button class="detail-tab${defaultTab === "grade" ? " active" : ""}" data-dtab="grade">Grade</button>` : ""}
      <button class="detail-tab${defaultTab === "prices" ? " active" : ""}" data-dtab="prices">Prices</button>
    </div>
    <div class="detail-tab-panel${defaultTab === "grade" ? "" : " hidden"}" data-dtpanel="grade">
      ${gradeHtml}
    </div>
    <div class="detail-tab-panel${defaultTab === "prices" ? "" : " hidden"}" data-dtpanel="prices">
      ${!hasGrade && !slabLabel ? `<div class="no-grade-note">${images.length <= 1 ? "AI grading unavailable — single photo" : "AI grading unavailable"}</div>` : ""}
      ${slabLabel ? renderPsaInline(currentPsaSignal) : ""}
      <div id="grading-roi" class="grading-roi hidden"></div>
      <div id="arbitrage-container" class="arbitrage-container hidden"></div>
      <div id="price-chart-container" class="price-chart-container hidden">
        <div class="detail-grade-section-label">Price History</div>
        <canvas id="price-chart" height="140"></canvas>
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
      if (tab.dataset.dtab === "prices" && pendingChartPoints) {
        const c = document.getElementById("price-chart");
        if (c && c.parentElement.clientWidth > 0) drawPriceChart(c, pendingChartPoints);
      }
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
  loadGradingRoi(item);
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
    const parts = [
      `<span class="card-id-badge">${esc(card.cardId)}</span>`,
      card.rarity ? `<span class="card-id-rarity">${esc(card.rarity)}</span>` : "",
      setName ? `<span class="card-id-set">${esc(setName)}</span>` : "",
      nameHtml ? `<span class="card-id-sep"></span>${nameHtml}` : "",
    ].filter(Boolean).join("");
    container.innerHTML = parts;
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

    const magiData = sources.magi || sources.Magi;
    currentMagiMarket = magiData ? { lowest: magiData.lowest, priceJPY: magiData.priceJPY, count: magiData.count } : null;

    const sorted = names.sort((a, b) => sources[a].lowest - sources[b].lowest);
    const savingsHtml = arb ? (() => {
      const match = arb.summary.match(/\$[\d,.]+/);
      const pctMatch = arb.summary.match(/(\d+%)\s*spread/);
      const savings = match ? match[0] : "";
      const spread = pctMatch ? pctMatch[1] : "";
      return `<div class="arb-summary">${savings} cheaper on ${esc(arb.cheapest.source)}${spread ? `<span class="arb-summary-spread">${spread} spread</span>` : ""}</div>`;
    })() : "";

    container.innerHTML = `
      <div class="detail-grade-section-label">Cross-Source Prices</div>
      <div class="arbitrage-sources">
        ${sorted.map(s => {
          const d = sources[s];
          const isCheapest = arb && s === arb.cheapest.source;
          return `<div class="arb-source${isCheapest ? " arb-cheapest" : ""}">
            <div class="arb-source-name">${esc(s)}</div>
            <div class="arb-source-price">${formatPrice(d.lowest, d.currency)}</div>
            ${d.priceJPY ? `<div class="arb-source-jpy">¥${d.priceJPY.toLocaleString()}</div>` : ""}
            <div class="arb-source-count">${d.count} listing${d.count !== 1 ? "s" : ""}</div>
            ${isCheapest ? `<span class="arb-best-chip">Best Price</span>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${savingsHtml}
    `;
  } catch {}
}

function loadGradingRoi(item) {
  const container = document.getElementById("grading-roi");
  if (!container) return;
  if (!currentPsaSignal || item.listingGradeLabel) return;

  const psa = currentPsaSignal;
  const rawPrice = item.totalCost || item.price;
  if (!rawPrice || !psa.estCost) return;

  const gradingCost = parseFloat(psa.estCost.replace(/[^0-9.]/g, ""));
  if (!gradingCost) return;

  const gemPct = psa.gem10Pct || 0;
  const totalCost = rawPrice + gradingCost;
  const diffClass = psa.difficulty === "easy" ? "easy" : psa.difficulty === "hard" || psa.difficulty === "brutal" ? "hard" : "moderate";

  container.classList.remove("hidden");
  const profitable = gemPct >= 50;
  const verdictClass = profitable ? "roi-yes" : "roi-no";
  const verdict = profitable ? "Worth grading" : "Risky";

  container.innerHTML = `
    <div class="detail-grade-section-label">Grade This Card?</div>
    <div class="roi-grid">
      <div class="roi-stat">
        <div class="roi-label">Raw Price</div>
        <div class="roi-value">${formatPrice(rawPrice, "USD")}</div>
      </div>
      <div class="roi-stat">
        <div class="roi-label">${esc(psa.tier)} Grading</div>
        <div class="roi-value">${esc(psa.estCost)}</div>
      </div>
      <div class="roi-stat">
        <div class="roi-label">Total Cost</div>
        <div class="roi-value roi-total">${formatPrice(totalCost, "USD")}</div>
      </div>
      <div class="roi-stat">
        <div class="roi-label">Gem Rate</div>
        <div class="roi-value">${gemPct}%</div>
      </div>
    </div>
    <div class="roi-psa-row">
      <span>Pop <b>${psa.totalPop ? psa.totalPop.toLocaleString() : "—"}</b></span>
      <span>Difficulty <b class="${diffClass}">${esc(psa.difficulty || "—")}</b></span>
      <span>PSA 10 <b>${psa.pop10 ? psa.pop10.toLocaleString() : "—"}</b></span>
      <span>PSA 9 <b>${psa.pop9 ? psa.pop9.toLocaleString() : "—"}</b></span>
    </div>
    <div class="roi-verdict ${verdictClass}">
      <span class="roi-verdict-label">${verdict}</span>
      <span class="roi-verdict-detail">${gemPct >= 50
        ? `${gemPct}% gem rate at ${esc(psa.estCost)} grading — favorable odds`
        : `${gemPct}% gem rate — high risk of PSA 9 or lower`}</span>
    </div>
    ${buildExpectedOutcome(item, psa)}
  `;
}

function buildExpectedOutcome(item, psa) {
  const grade = item.grade && !item.grade.error ? item.grade : null;
  if (!grade || grade.overall == null) return "";

  const aiScore = grade.overall;
  let expectedPsa, popAtGrade;
  if (aiScore >= 9.5) {
    expectedPsa = 10;
    popAtGrade = psa.pop10;
  } else if (aiScore >= 8.5) {
    expectedPsa = 9;
    popAtGrade = psa.pop9;
  } else if (aiScore >= 7.5) {
    expectedPsa = 8;
    popAtGrade = null;
  } else {
    expectedPsa = Math.floor(aiScore);
    popAtGrade = null;
  }

  const popStr = popAtGrade != null ? popAtGrade.toLocaleString() : null;

  let scarcityLabel = "";
  let scarcityClass = "";
  if (popAtGrade != null) {
    if (popAtGrade < 100) {
      scarcityLabel = "Scarce";
      scarcityClass = "scarce";
    } else if (popAtGrade <= 1000) {
      scarcityLabel = "Moderate scarcity";
      scarcityClass = "moderate";
    } else {
      scarcityLabel = "Common";
      scarcityClass = "common";
    }
  }

  return `
    <div class="roi-expected-outcome">
      <div class="roi-expected-label">Expected Outcome</div>
      <div class="roi-expected-row">
        <span class="roi-expected-grade">Likely PSA ${expectedPsa}</span>
        ${popStr ? `<span class="roi-expected-sep"></span><span class="roi-expected-pop">${popStr} exist</span>` : ""}
        ${scarcityLabel ? `<span class="roi-expected-sep"></span><span class="roi-expected-scarcity ${scarcityClass}">${scarcityLabel}</span>` : ""}
      </div>
    </div>`;
}

async function loadPriceChart(query) {
  const container = document.getElementById("price-chart-container");
  const canvas = document.getElementById("price-chart");
  const statsEl = document.getElementById("price-chart-stats");
  if (!container || !canvas) return;

  try {
    const res = await fetch(`/api/price-history?q=${encodeURIComponent(query)}&days=90&demo=true`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.history?.length) return;

    container.classList.remove("hidden");

    const points = data.history
      .filter(h => h.price > 0)
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

    if (points.length < 3) return;

    pendingChartPoints = points;
    if (canvas.parentElement.clientWidth > 0) drawPriceChart(canvas, points);

    if (data.stats) {
      statsEl.innerHTML = `
        <span>Low: <b>${formatPrice(data.stats.min, "USD")}</b></span>
        <span class="stat-avg">Avg: <b>${formatPrice(data.stats.avg, "USD")}</b></span>
        <span>High: <b>${formatPrice(data.stats.max, "USD")}</b></span>
        <span>${data.stats.count} sales</span>
      `;
    }

    if (data.tcgplayer?.marketPrice) {
      const tcg = data.tcgplayer;
      const tcgEl = document.createElement("div");
      tcgEl.className = "tcg-market-ref";
      tcgEl.innerHTML = `
        <div class="tcg-market-label">TCGPlayer Market</div>
        <div class="tcg-market-row">
          <span class="tcg-market-price">${formatPrice(tcg.marketPrice, "USD")}</span>
          ${tcg.listedMedianPrice ? `<span class="tcg-market-median">Median: ${formatPrice(tcg.listedMedianPrice, "USD")}</span>` : ""}
        </div>
        ${tcg.printingType ? `<div class="tcg-market-meta">${esc(tcg.printingType)}</div>` : ""}
      `;
      container.appendChild(tcgEl);
    }

  } catch {}
}

function drawPriceChart(canvas, points) {
  const ctx = canvas.getContext("2d");
  const w = canvas.parentElement.clientWidth;
  const h = 140;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + "px";

  const prices = points.map(p => p.price);
  const min = Math.min(...prices) * 0.95;
  const max = Math.max(...prices) * 1.05;
  const range = max - min || 1;

  const pad = { top: 10, right: 10, bottom: 32, left: 50 };
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

  // X-axis date labels
  const fmt = (d) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
  ctx.fillStyle = "rgba(138,138,154,0.6)";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const maxLabels = Math.min(points.length, 5);
  const step = maxLabels > 1 ? (points.length - 1) / (maxLabels - 1) : 0;
  for (let i = 0; i < maxLabels; i++) {
    const idx = Math.round(i * step);
    const x = pad.left + (idx / (points.length - 1 || 1)) * cw;
    ctx.fillText(fmt(points[idx].recordedAt), x, h - 6);
  }
}

function renderPsaInline(psa) {
  if (!psa) return "";
  const diffClass = psa.difficulty === "easy" ? "easy" : psa.difficulty === "hard" || psa.difficulty === "brutal" ? "hard" : "moderate";
  const gemPct = psa.gem10Pct != null ? psa.gem10Pct : null;
  const tierLabel = psa.tier || "—";
  const costLabel = psa.estCost ? `<span class="psa-inline-cost">${esc(psa.estCost)}</span>` : "";

  return `<div class="psa-inline">
    <div class="psa-inline-stat">
      <div class="psa-inline-label">Gem</div>
      <div class="gem-bar">
        <span class="psa-inline-value">${gemPct != null ? gemPct + "%" : "—"}</span>
        ${gemPct != null ? `<div class="gem-bar-track"><div class="gem-bar-fill" style="width: ${gemPct}%"></div></div>` : ""}
      </div>
    </div>
    <div class="psa-inline-stat">
      <div class="psa-inline-label">Pop</div>
      <div class="psa-inline-value">${psa.totalPop != null ? psa.totalPop.toLocaleString() : "—"}</div>
    </div>
    <div class="psa-inline-stat">
      <div class="psa-inline-label">Difficulty</div>
      <div class="psa-inline-value ${diffClass}">${esc(psa.difficulty || "—")}</div>
    </div>
    <div class="psa-inline-stat">
      <div class="psa-inline-label">Tier</div>
      <div class="psa-inline-value">${esc(tierLabel)}${costLabel}</div>
    </div>
  </div>`;
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

const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); fadeObserver.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll(".fade-up").forEach(el => fadeObserver.observe(el));

document.querySelectorAll(".alert-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".alert-type-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const type = btn.dataset.type;
    document.getElementById("alert-type").value = type;
    document.getElementById("price-fields").classList.toggle("hidden", type !== "price");
    document.getElementById("arb-fields").classList.toggle("hidden", type !== "arbitrage");
    document.getElementById("alert-desc").textContent = type === "price"
      ? "Get notified when the price drops below your target."
      : "Get notified when the cross-source spread exceeds your threshold.";
  });
});

alertForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("alert-email").value.trim();
  const type = document.getElementById("alert-type").value;
  if (!email || !currentQuery) return;

  const body = { email, query: currentQuery, type };
  if (type === "price") {
    body.targetPrice = parseFloat(document.getElementById("alert-price").value);
    if (!body.targetPrice) return;
  } else {
    body.spreadThreshold = parseInt(document.getElementById("alert-spread").value) || 10;
  }

  try {
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const msg = type === "price"
      ? `Price alert set for ${formatPrice(body.targetPrice, "USD")}`
      : `Arbitrage alert set for ${body.spreadThreshold}% spread`;
    alertMsg.textContent = res.ok ? msg : "Saved — we'll notify you when alerts go live.";
    alertMsg.style.color = res.ok ? "var(--green)" : "var(--gold)";
  } catch {
    alertMsg.textContent = "Saved — we'll notify you when alerts go live.";
    alertMsg.style.color = "var(--gold)";
  }
  alertMsg.classList.remove("hidden");
});

// ── Portfolio ──

const portfolioLoadBtn = document.getElementById("portfolio-load");
const portfolioStatsEl = document.getElementById("portfolio-stats");
const portfolioCardsEl = document.getElementById("portfolio-cards");

if (portfolioLoadBtn) {
  portfolioLoadBtn.addEventListener("click", loadPortfolio);
}

async function loadPortfolio() {
  portfolioLoadBtn?.classList.add("hidden");
  portfolioCardsEl.innerHTML = "<p style='color:rgba(255,255,255,0.4);text-align:center;padding:20px'>Loading...</p>";
  try {
    const res = await fetch("/api/portfolio?demo=true");
    const data = await res.json();
    renderPortfolio(data);
  } catch {
    portfolioCardsEl.innerHTML = "<p style='color:var(--red);text-align:center;padding:20px'>Failed to load portfolio</p>";
  }
}

function renderPortfolio(data) {
  const roiClass = data.roiPercent >= 0 ? "positive" : "negative";
  const roiSign = data.roiPercent >= 0 ? "+" : "";

  portfolioStatsEl.innerHTML = `
    <div class="portfolio-stat"><div class="stat-label">Cards</div><div class="stat-value">${data.cards.length}</div></div>
    <div class="portfolio-stat"><div class="stat-label">Total Cost</div><div class="stat-value">${formatPrice(data.totalCost, "USD")}</div></div>
    <div class="portfolio-stat"><div class="stat-label">Current Value</div><div class="stat-value">${formatPrice(data.totalValue, "USD")}</div></div>
    <div class="portfolio-stat"><div class="stat-label">ROI</div><div class="stat-value ${roiClass}">${roiSign}${data.roiPercent}%</div></div>
  `;
  portfolioStatsEl.classList.remove("hidden");

  portfolioCardsEl.innerHTML = data.cards.map(c => {
    const cRoiClass = c.roi >= 0 ? "positive" : "negative";
    const cRoiSign = c.roi >= 0 ? "+" : "";
    return `<div class="portfolio-card">
      <div class="portfolio-card-left">
        <span class="portfolio-card-name">${c.query}</span>
        <span class="portfolio-card-id">${c.cardId} &middot; ${c.purchaseSource}</span>
      </div>
      <div class="portfolio-card-right">
        <div class="portfolio-card-prices">
          <span class="portfolio-card-current">${formatPrice(c.currentPrice, "USD")}</span>
          <span class="portfolio-card-purchase">Bought: ${formatPrice(c.purchasePrice, "USD")}</span>
        </div>
        <span class="portfolio-roi ${cRoiClass}">${cRoiSign}${c.roi}%</span>
      </div>
    </div>`;
  }).join("");
}
