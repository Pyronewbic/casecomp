(() => {
  // Walmart uses Queue-it. Queue data arrives two ways:
  // 1) URL param ?qpdata=<encoded JSON> with ticket, expectedTurnTimeUnixTimestamp, admissionLikelihood
  // 2) Intercepted validateTickets API responses (via walmart-inject.js in MAIN world)
  // Also uses PerimeterX for bot protection (#px-captcha, press-and-hold challenges).

  let ticketData = null;

  // Listen for intercepted validateTickets data from the MAIN-world inject script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "CSB_WALMART_QUEUE") return;
    ticketData = event.data.payload;
  });

  const ATC_SELECTORS = [
    '[data-testid="add-to-cart-btn"]',
    'button[data-testid="add-to-cart"]',
    'button[data-tl-id="ProductPrimaryCTA-normal"]',
    ".prod-product-cta button",
  ];

  const CAPTCHA_SELECTORS = [
    "#px-captcha",
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    ".g-recaptcha",
    ".h-captcha",
    "#cf-challenge-running",
    '[data-testid="captcha"]',
  ];

  const THROUGH_MARKERS = [
    '[data-testid="add-to-cart-btn"]',
    'button[data-testid="add-to-cart"]',
    ".prod-product-cta",
    '[itemprop="offers"]',
  ];

  function parseQpdata() {
    try {
      const url = new URL(window.location.href);
      const encoded = url.searchParams.get("qpdata");
      if (!encoded) return null;
      return JSON.parse(decodeURIComponent(encoded));
    } catch {
      return null;
    }
  }

  function detectCaptcha() {
    for (const sel of CAPTCHA_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    }
    const bodyText = document.body?.innerText || "";
    if (/press & hold|verify you('re| are) (a )?human|robot check/i.test(bodyText)) return true;
    return false;
  }

  function detect() {
    if (detectCaptcha()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "PerimeterX CAPTCHA — press & hold to solve!" };
    }

    // Check Queue-it URL params
    const qp = parseQpdata();
    if (qp) {
      const details = [];
      if (qp.ticket) details.push(`Ticket: ${qp.ticket}`);
      if (qp.expectedTurnTimeUnixTimestamp) {
        const turnTime = new Date(qp.expectedTurnTimeUnixTimestamp).toLocaleTimeString();
        details.push(`Turn: ${turnTime}`);
      }
      if (qp.customMetadata?.admissionLikelihood) {
        details.push(`Likelihood: ${qp.customMetadata.admissionLikelihood}`);
      }
      if (qp.customMetadata?.item?.name) {
        details.push(qp.customMetadata.item.name);
      }
      return {
        inQueue: true,
        joinable: false,
        position: details.join(" | ") || null,
        detail: details.length ? `Queue-it — ${details.join(" | ")}` : "In Walmart Queue-it queue",
      };
    }

    // Check intercepted validateTickets data
    if (ticketData) {
      const tickets = Array.isArray(ticketData) ? ticketData : [ticketData];
      const active = tickets.filter((t) => t && t.ticket);
      if (active.length) {
        const t = active[0];
        const details = [`Ticket: ${t.ticket}`];
        if (t.expectedTurnTimeUnixTimestamp) {
          details.push(`Turn: ${new Date(t.expectedTurnTimeUnixTimestamp).toLocaleTimeString()}`);
        }
        return {
          inQueue: true,
          joinable: false,
          position: details.join(" | "),
          detail: `Queue-it — ${details.join(" | ")}`,
        };
      }
    }

    // Check for "Hold my spot" / queue landing page
    const bodyText = document.body?.innerText || "";
    if (/hold my spot|you('re| are) in (a )?line|waiting room|high demand/i.test(bodyText)
        && !/add to cart/i.test(bodyText)) {
      const holdBtn = findHoldSpotButton();
      return {
        inQueue: true,
        joinable: !!holdBtn,
        detail: "Walmart queue landing page detected",
      };
    }

    // Check if we're through
    for (const sel of THROUGH_MARKERS) {
      if (document.querySelector(sel)) {
        return { inQueue: false, through: true, detail: "Product page loaded — you're through!" };
      }
    }

    return { inQueue: false, through: false };
  }

  function findHoldSpotButton() {
    const allBtns = document.querySelectorAll("button, input[type='submit'], a.btn");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "").toLowerCase();
      if (/hold my spot|join|get in line|enter/i.test(txt) && isVisible(btn)) return btn;
    }
    return null;
  }

  function findAtcButton() {
    for (const sel of ATC_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const txt = (el.textContent || el.value || "").toLowerCase();
        if (/add to cart/i.test(txt) && isVisible(el) && !el.disabled) return el;
      }
    }
    const allBtns = document.querySelectorAll("button, input[type='submit']");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "").toLowerCase();
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
    const btn = findHoldSpotButton();
    if (!btn) return false;
    btn.click();
    return true;
  }

  function addToCart() {
    const btn = findAtcButton();
    if (!btn) return false;
    btn.click();
    return true;
  }

  window.__csbSiteHandler = {
    id: "walmart",
    name: "Walmart",
    detect,
    join,
    addToCart,
  };
})();
