const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SEARCH_URL = "https://mp-search-api.tcgplayer.com/v1/search/request?q=QUERY&isList=false";
const PRICE_URL = "https://mpapi.tcgplayer.com/v2/product/PRODUCT_ID/pricepoints";

export async function searchTCGPlayer(cardName, { limit = 3 } = {}) {
  const q = encodeURIComponent(cardName.trim());
  try {
    const res = await fetch(SEARCH_URL.replace("QUERY", q), {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({
        algorithm: "sales_synergy",
        from: 0,
        size: limit,
        filters: { term: { productLineName: ["pokemon"] } },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.results?.[0]?.results || [];
    return items.map(i => ({
      productId: i.productId,
      name: i.productName,
      marketPrice: i.marketPrice,
      setName: i.setName,
    }));
  } catch {
    return [];
  }
}

export async function getTCGPlayerPrice(productId) {
  try {
    const res = await fetch(PRICE_URL.replace("PRODUCT_ID", productId), {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    const foil = data.find(p => p.printingType === "Foil" && p.marketPrice);
    const normal = data.find(p => p.printingType === "Normal" && p.marketPrice);
    const best = foil || normal;
    if (!best) return null;
    return {
      marketPrice: best.marketPrice,
      listedMedianPrice: best.listedMedianPrice,
      printingType: best.printingType,
    };
  } catch {
    return null;
  }
}

export async function seedFromTCGPlayer(cardName) {
  let products = await searchTCGPlayer(cardName, { limit: 1 });
  if (!products.length) {
    const simpler = cardName.replace(/\d{3}\/\d{3}/g, "").replace(/SAR|SR|AR/gi, "").trim();
    if (simpler !== cardName.trim()) products = await searchTCGPlayer(simpler, { limit: 1 });
  }
  if (!products.length) return null;

  const product = products[0];
  const price = await getTCGPlayerPrice(product.productId);
  if (!price) return null;

  return {
    source: "tcgplayer",
    productId: product.productId,
    name: product.name,
    setName: product.setName,
    price: price.marketPrice,
    listedMedianPrice: price.listedMedianPrice,
    printingType: price.printingType,
  };
}
