(() => {
  const ATC_SELECTORS = [
    '[data-test="shipItButton"]',
    '[data-test="addToCartButton"]',
    'button[data-test="orderPickupButton"]',
    'button[aria-label*="add to cart" i]',
  ];

  const CAPTCHA_SELECTORS = [
    "#sec-cpt-if",
    'iframe[src*="captcha"]',
    'iframe[src*="challenge"]',
    ".g-recaptcha",
  ];

  const THROUGH_MARKERS = [
    '[data-test="shipItButton"]',
    '[data-test="addToCartButton"]',
    '[data-test="orderPickupButton"]',
    '[data-test="product-price"]',
  ];

  function detectCaptcha() {
    for (const sel of CAPTCHA_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function detect() {
    if (detectCaptcha()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "Target CAPTCHA — solve manually!" };
    }

    const bodyText = document.body?.innerText || "";
    if (/waiting room|high demand|you('re| are) in (a )?line|please wait/i.test(bodyText)
        && !/add to cart/i.test(bodyText)) {
      return {
        inQueue: true,
        joinable: false,
        detail: "Target waiting room detected",
      };
    }

    for (const sel of THROUGH_MARKERS) {
      if (document.querySelector(sel)) {
        return { inQueue: false, through: true, detail: "Product page loaded — you're through!" };
      }
    }

    return { inQueue: false, through: false };
  }

  function findAtcButton() {
    for (const sel of ATC_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !el.disabled) return el;
    }
    const allBtns = document.querySelectorAll("button");
    for (const btn of allBtns) {
      const txt = (btn.textContent || "").toLowerCase();
      if (/add to cart/i.test(txt) && isVisible(btn) && !btn.disabled) return btn;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function join() {
    return false;
  }

  function addToCart() {
    const btn = findAtcButton();
    if (!btn) return false;
    btn.click();
    return true;
  }

  window.__csbSiteHandler = {
    id: "target",
    name: "Target",
    detect,
    join,
    addToCart,
  };
})();
