(() => {
  let lastProducts = new Map();
  let initialized = false;

  function isListingPage() {
    const path = window.location.pathname;
    return /^\/(category|search|collections|products)/.test(path) ||
      document.querySelector('[data-testid="product-grid"], .product-grid, [class*="productList"]');
  }

  function scanProducts() {
    const cards = document.querySelectorAll(
      'a[href*="/product/"], [data-testid="product-tile"] a, .product-card a, [class*="productTile"] a'
    );
    const products = new Map();
    cards.forEach((a) => {
      const href = a.href;
      if (!href || products.has(href)) return;
      const name = (a.querySelector('[class*="productName"], [class*="title"], h3, h2') || a).textContent.trim().slice(0, 100);
      const priceEl = a.querySelector('[class*="price"], [class*="Price"]');
      const price = priceEl ? priceEl.textContent.trim() : "";
      if (name) products.set(href, { name, price, url: href });
    });
    return products;
  }

  function checkForNew(current) {
    if (!initialized) {
      initialized = true;
      lastProducts = current;
      chrome.storage.local.get(["pcListings"], (data) => {
        const stored = data.pcListings || {};
        for (const [url, product] of current) {
          if (!stored[url]) {
            report(product);
            stored[url] = { name: product.name, ts: new Date().toISOString() };
          }
        }
        chrome.storage.local.set({ pcListings: stored });
      });
      return;
    }

    const newProducts = [];
    for (const [url, product] of current) {
      if (!lastProducts.has(url)) newProducts.push(product);
    }
    lastProducts = current;

    if (newProducts.length) {
      chrome.storage.local.get(["pcListings"], (data) => {
        const stored = data.pcListings || {};
        for (const p of newProducts) {
          if (!stored[p.url]) {
            report(p);
            stored[p.url] = { name: p.name, ts: new Date().toISOString() };
          }
        }
        chrome.storage.local.set({ pcListings: stored });
      });
    }
  }

  function report(product) {
    chrome.runtime.sendMessage({
      type: "QUEUE_STATUS",
      site: "pokemon-center",
      status: "new-listing",
      detail: `New: ${product.name}${product.price ? " — " + product.price : ""} — ${product.url}`,
    });
  }

  function tick() {
    if (!isListingPage()) return;
    const products = scanProducts();
    if (products.size) checkForNew(products);
  }

  setInterval(tick, 10000);
  setTimeout(tick, 2000);
})();
