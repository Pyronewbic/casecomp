(() => {
  // Pokemon Center uses Imperva/Incapsula waiting room.
  // Queue manifests as an iframe with src containing /_Incapsula_Resource.
  // Wait time lives in #ttw inside the iframe (format HH:MM:SS).
  // Position can be polled: GET /_Incapsula_Resource?SWWRGTS=868 → {pos} (pos === -1 means through).

  const INCAPSULA_POLL_INTERVAL = 10000;
  let lastPolledPos = null;
  let pollTimer = null;

  const ATC_SELECTORS = [
    'button[data-testid="add-to-cart"]',
    ".add-to-cart button",
    'button.add-to-cart',
    'input[value*="Add to Cart" i]',
  ];

  const CAPTCHA_SELECTORS = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    ".g-recaptcha",
    ".h-captcha",
    "#cf-challenge-running",
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
      const res = await fetch("https://www.pokemoncenter.com/_Incapsula_Resource?SWWRGTS=868", {
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
      return { inQueue: true, captcha: true, joinable: false, detail: "CAPTCHA detected — solve manually!" };
    }

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
          ? `Incapsula queue — ${posDetail.join(" | ")}`
          : "In Incapsula waiting room",
      };
    }

    if (lastPolledPos === -1 || !findIncapsulaIframe()) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      const atcBtn = findAtcButton();
      if (atcBtn) {
        return { inQueue: false, through: true, detail: "Product page loaded — you're through!" };
      }
    }

    // Fallback: text-based detection for unknown queue variants
    const bodyText = document.body?.innerText || "";
    if (/you are now in line|waiting room|queue/i.test(bodyText) && !/add to cart/i.test(bodyText)) {
      return { inQueue: true, joinable: false, detail: "Waiting room text detected" };
    }

    return { inQueue: false, through: false };
  }

  function findAtcButton() {
    for (const sel of ATC_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const txt = (el.textContent || el.value || "").toLowerCase();
        if (/add to (cart|bag)/i.test(txt) && isVisible(el) && !el.disabled) return el;
      }
    }
    const allBtns = document.querySelectorAll("button, input[type='submit']");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "").toLowerCase();
      if (/add to (cart|bag)/i.test(txt) && isVisible(btn) && !btn.disabled) return btn;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function join() {
    // Incapsula queues are automatic — no join button. Return false.
    return false;
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
    id: "pokemon-center",
    name: "Pokémon Center",
    detect,
    join,
    addToCart,
  };
})();
