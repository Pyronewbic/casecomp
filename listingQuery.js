/**
 * Build the eBay `q` string (no extra quoting). Card name stays first so
 * fuzzy relevance still uses the CARDS[] string as the semantic base.
 */
export function buildEbaySearchQuery(cardName, config) {
  const fmt = config.listingFormat ?? "raw";
  const base = String(cardName || "").trim();
  if (fmt === "slab") {
    const p = String(config.slab?.provider ?? "PSA").trim();
    const g = String(config.slab?.grade ?? "10").trim();
    return `${base} ${p} ${g}`.replace(/\s+/g, " ").trim();
  }
  const suffix = String(config.rawSearchSuffix ?? "raw").trim();
  if (suffix) return `${base} ${suffix}`.replace(/\s+/g, " ").trim();
  return base;
}

/** Short label for logs / markdown. */
export function describeListingSearch(config) {
  const fmt = config.listingFormat ?? "raw";
  if (fmt === "slab") {
    const p = String(config.slab?.provider ?? "PSA").trim();
    const g = String(config.slab?.grade ?? "10").trim();
    return `slab (${p} ${g})`;
  }
  const suffix = String(config.rawSearchSuffix ?? "raw").trim();
  return suffix ? `raw (q+ "${suffix}")` : "raw";
}
