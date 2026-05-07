(() => {
  // Costco likely uses Imperva/Incapsula waiting room (same vendor as Pokemon Center).
  // Also falls back to text-based queue detection for their newer custom queue system.
  // Random placement — no position number, just a wait.

  const INCAPSULA_POLL_INTERVAL = 10000;
  let lastPolledPos = null;
  let pollTimer = null;

  const ATC_SELECTORS = [
    "#add-to-cart-btn",
    'input[value="Add to Cart"]',
    'button[id*="add-to-cart"]',
    ".add-to-cart-btn",
    'input[type="submit"][value*="Add to Cart" i]',
  ];

  const CAPTCHA_SELECTORS = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    ".g-recaptcha",
    ".h-captcha",
    "#cf-challenge-running",
    "#challenge-running",
    "#challenge-form",
  ];

  const THROUGH_MARKERS = [
    "#add-to-cart-btn",
    'input[value="Add to Cart"]',
    ".product-info-container",
    "#product-page",
  ];

  function findIncapsulaIframe() {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      if (iframe.src && iframe.src.includes("/_Incapsula_Resource")) return iframe;
    }
    return null;
  }

  function getEstimatedWaitTime() {
    const ttwEl = document.getElementById("ttw");
    if (ttwEl) return ttwEl.textContent?.trim() || null;

    const iframe = findIncapsulaIframe();
    if (!iframe) return null;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      const iframeTtw = doc?.getElementById("ttw");
      return iframeTtw?.textContent?.trim() || null;
    } catch {
      return null;
    }
  }

  async function pollPosition() {
    try {
      const res = await fetch("https://www.costco.com/_Incapsula_Resource?SWWRGTS=868", {
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      lastPolledPos = data.pos ?? null;
      return lastPolledPos;
    } catch {
      return null;
    }
  }

  function detectCaptcha() {
    for (const sel of CAPTCHA_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function detect() {
    if (detectCaptcha()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "Costco CAPTCHA — solve manually!" };
    }

    // Check for Incapsula iframe (same system as Pokemon Center)
    const iframe = findIncapsulaIframe();
    if (iframe) {
      if (!pollTimer) {
        pollTimer = setInterval(pollPosition, INCAPSULA_POLL_INTERVAL);
        pollPosition();
      }

      const ttw = getEstimatedWaitTime();
      const posDetail = [];
      if (lastPolledPos != null && lastPolledPos !== -1) posDetail.push(`Position: ${lastPolledPos}`);
      if (ttw) posDetail.push(`ETA: ${ttw}`);

      return {
        inQueue: true,
        joinable: false,
        position: posDetail.join(" | ") || null,
        detail: posDetail.length
          ? `Costco queue — ${posDetail.join(" | ")}`
          : "In Costco waiting room",
      };
    }

    if (lastPolledPos === -1 || !findIncapsulaIframe()) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    // Text-based detection for Costco's custom queue pages
    const bodyText = document.body?.innerText || "";
    if (/virtual (waiting )?room|you('re| are) in (a )?line|high demand|please wait/i.test(bodyText)
        && !/add to cart/i.test(bodyText)) {
      const joinBtn = findJoinButton();
      return {
        inQueue: true,
        joinable: !!joinBtn,
        detail: "Costco waiting room detected",
      };
    }

    // Check for queue-specific DOM elements
    const queueEls = document.querySelectorAll('[class*="queue"], [class*="waiting-room"], [id*="queue"]');
    for (const el of queueEls) {
      const text = el.textContent || "";
      if (/queue|wait|line|demand/i.test(text) && isVisible(el)) {
        return {
          inQueue: true,
          joinable: false,
          detail: "Costco queue element detected",
        };
      }
    }

    for (const sel of THROUGH_MARKERS) {
      if (document.querySelector(sel)) {
        return { inQueue: false, through: true, detail: "Product page loaded — you're through!" };
      }
    }

    return { inQueue: false, through: false };
  }

  function findJoinButton() {
    const allBtns = document.querySelectorAll("button, input[type='submit'], a.btn");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "").toLowerCase();
      if (/join|enter|continue|refresh|try again/i.test(txt) && isVisible(btn)) return btn;
    }
    return null;
  }

  function findAtcButton() {
    for (const sel of ATC_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !el.disabled) return el;
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
    const btn = findJoinButton();
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

  // Watch for dynamically injected Incapsula iframes
  const observer = new MutationObserver(() => {
    const iframe = findIncapsulaIframe();
    if (iframe && !pollTimer) {
      pollTimer = setInterval(pollPosition, INCAPSULA_POLL_INTERVAL);
      pollPosition();
    } else if (!iframe && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.__csbSiteHandler = {
    id: "costco",
    name: "Costco",
    detect,
    join,
    addToCart,
  };
})();
