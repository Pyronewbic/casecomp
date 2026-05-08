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
    'button[class*="add-to-cart"]',
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
    const iframe = findIncapsulaIframe();
    if (iframe) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          const iframeTtw = doc.getElementById("ttw") || doc.querySelector('[id*="ttw"], .ttw, [class*="estimatedWait"], [class*="wait-time"]');
          if (iframeTtw) return iframeTtw.textContent?.trim() || null;
        }
      } catch {}
    }
    const ttwEl = document.getElementById("ttw") || document.querySelector('[class*="estimatedWait"], [class*="wait-time"], [class*="waitTime"]');
    if (ttwEl) return ttwEl.textContent?.trim() || null;
    return null;
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

  function hasQueueIndicators() {
    if (findIncapsulaIframe()) return true;
    const bodyText = (document.body?.innerText || "").slice(0, 3000);
    return /you are now in line|waiting room|please wait/i.test(bodyText) &&
      !/add to cart/i.test(bodyText);
  }

  function detectAccessDenied() {
    const bodyText = (document.body?.innerText || "").slice(0, 2000);
    if (/access denied|error 17|blocked by our security/i.test(bodyText)) return true;
    const title = document.title || "";
    if (/access denied/i.test(title)) return true;
    return false;
  }

  function detect() {
    if (detectAccessDenied()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "Access denied (Error 17) — IP may be rate-limited. Wait and refresh." };
    }

    if (detectCaptcha()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "CAPTCHA detected — solve manually!" };
    }

    const iframe = findIncapsulaIframe();

    if (iframe) {
      if (!pollTimer) {
        pollTimer = setInterval(pollPosition, INCAPSULA_POLL_INTERVAL);
        pollPosition();
      }

      if (lastPolledPos === -1) {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        return { inQueue: false, through: true, detail: "Position cleared — you're through" };
      }

      const ttw = getEstimatedWaitTime();
      const posDetail = [];
      if (lastPolledPos != null) posDetail.push(`Position: ${lastPolledPos}`);
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

    const ready = document.readyState === "complete" || document.readyState === "interactive";
    const queueFound = hasQueueIndicators();
    if (!queueFound && ready) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      return { inQueue: false, through: true, detail: "No queue detected — site loaded" };
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
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function join() {
    // Incapsula queues are automatic — no join button. Return false.
    return false;
  }

  function addToCart() {
    const btn = findAtcButton();
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    setTimeout(() => {
      if (window.location.hostname.includes("pokemoncenter")) {
        window.location.href = "https://www.pokemoncenter.com/checkout";
      }
    }, 1500);
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

  const PC_CHECKOUT_SELECTORS = {
    cartBtn: ['.cart-button', '[data-testid="cart-button"]', 'a[href*="/cart"]'],
    checkoutBtn: ['[data-testid="checkout-btn"]', '.checkout-button'],
    continueBtn: ['[data-testid="continue-btn"]', 'button[data-testid="shipping-continue"]'],
    placeOrderBtn: ['[data-testid="place-order"]', '.place-order-btn'],
    orderConfirmation: ['.order-confirmation', '[data-testid="order-confirmation"]'],
  };

  function findCheckoutEl(selectors, textFallback) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    if (textFallback) {
      const allBtns = document.querySelectorAll("button, a.btn, input[type='submit']");
      const re = new RegExp(textFallback, "i");
      for (const btn of allBtns) {
        const txt = (btn.textContent || btn.value || "").trim();
        if (re.test(txt) && isVisible(btn) && !btn.disabled) return btn;
      }
    }
    return null;
  }

  function sendPCCheckoutStatus(status, detail) {
    chrome.runtime.sendMessage({
      type: "QUEUE_STATUS",
      site: "Pokémon Center",
      status: status,
      detail: detail || "",
    });
  }

  function waitForPCElement(selectors, textFallback, timeoutMs) {
    return new Promise((resolve) => {
      const deadline = Date.now() + (timeoutMs || 15000);
      const check = () => {
        const el = findCheckoutEl(selectors, textFallback);
        if (el) return resolve(el);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(check, 500);
      };
      check();
    });
  }

  async function checkout() {
    try {
      // Step 1: Navigate to cart if not on cart/checkout page
      if (!window.location.pathname.startsWith("/cart") && !window.location.pathname.startsWith("/checkout")) {
        const cartLink = findCheckoutEl(PC_CHECKOUT_SELECTORS.cartBtn, null);
        if (cartLink) {
          cartLink.click();
        } else {
          window.location.href = "/cart";
        }
        return;
      }

      // Step 2: Click checkout button
      const checkoutBtn = await waitForPCElement(PC_CHECKOUT_SELECTORS.checkoutBtn, "Checkout", 10000);
      if (!checkoutBtn) {
        sendPCCheckoutStatus("checkout-failed", "Could not find checkout button");
        return false;
      }
      checkoutBtn.click();
      sendPCCheckoutStatus("checkout-shipping", "Proceeding to shipping...");

      // Step 3: Shipping — wait for continue
      const shipBtn = await waitForPCElement(PC_CHECKOUT_SELECTORS.continueBtn, "Continue", 20000);
      if (!shipBtn) {
        sendPCCheckoutStatus("checkout-failed", "Could not find continue button on shipping");
        return false;
      }
      shipBtn.click();
      sendPCCheckoutStatus("checkout-payment", "Proceeding to payment...");

      // Step 4: Payment — wait for continue
      const payBtn = await waitForPCElement(PC_CHECKOUT_SELECTORS.continueBtn, "Continue", 20000);
      if (!payBtn) {
        sendPCCheckoutStatus("checkout-failed", "Could not find continue button on payment");
        return false;
      }
      payBtn.click();
      sendPCCheckoutStatus("checkout-review", "Reviewing order...");

      // Step 5: Place order
      const placeBtn = await waitForPCElement(PC_CHECKOUT_SELECTORS.placeOrderBtn, "Place Order", 20000);
      if (!placeBtn) {
        sendPCCheckoutStatus("checkout-failed", "Could not find place order button");
        return false;
      }
      placeBtn.click();

      // Step 6: Confirm
      const confirm = await waitForPCElement(PC_CHECKOUT_SELECTORS.orderConfirmation, "Order placed", 30000);
      if (confirm) {
        sendPCCheckoutStatus("checkout-success", "Order placed successfully!");
        return true;
      } else {
        sendPCCheckoutStatus("checkout-failed", "Order confirmation not detected");
        return false;
      }
    } catch (err) {
      sendPCCheckoutStatus("checkout-failed", "Checkout error: " + (err?.message || "unknown"));
      return false;
    }
  }

  window.__csbSiteHandler = {
    id: "pokemon-center",
    name: "Pokémon Center",
    detect,
    join,
    addToCart,
    checkout,
  };
})();
