(() => {
  // Pokemon Center Japan (pokemoncenter-online.com) uses:
  // 1) Waiting room queue during high traffic — likely Incapsula/Imperva (same vendor as US)
  // 2) Lottery system (抽選販売) for TCG products — auto-submit application
  //
  // Domain: www.pokemoncenter-online.com
  // Lottery pages: /lottery/apply.html, /lottery/landing-page.html
  // Lottery applications at: pokemoncenter.pokemon.co.jp

  const INCAPSULA_POLL_INTERVAL = 10000;
  let lastPolledPos = null;
  let pollTimer = null;

  const ATC_SELECTORS = [
    'button[class*="cart"]',
    'input[value*="カートに入れる"]',
    'button[class*="add-cart"]',
    'a[class*="cart"]',
    "#add-to-cart",
    'input[type="submit"][value*="cart" i]',
  ];

  const CAPTCHA_SELECTORS = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    ".g-recaptcha",
    ".h-captcha",
    "#cf-challenge-running",
  ];

  const LOTTERY_SELECTORS = [
    'a[href*="/lottery/"]',
    'button[class*="lottery"]',
    'input[value*="抽選"]',
    'a[class*="lottery"]',
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
      const res = await fetch("https://www.pokemoncenter-online.com/_Incapsula_Resource?SWWRGTS=868", {
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

  function isLotteryPage() {
    const path = window.location.pathname;
    return path.includes("/lottery/") || path.includes("/chusen/");
  }

  function detectLotteryButton() {
    for (const sel of LOTTERY_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    const allBtns = document.querySelectorAll("button, input[type='submit'], a.btn, a.button");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "").toLowerCase();
      if (/抽選に進む|応募する|lottery|apply|抽選販売/i.test(txt) && isVisible(btn)) return btn;
    }
    return null;
  }

  function detect() {
    if (detectCaptcha()) {
      return { inQueue: true, captcha: true, joinable: false, detail: "CAPTCHA detected — solve manually!" };
    }

    // Incapsula queue (same mechanism as US site)
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
          ? `PC Japan queue — ${posDetail.join(" | ")}`
          : "In PC Japan waiting room",
      };
    }

    if (lastPolledPos === -1) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // Lottery page detection
    if (isLotteryPage()) {
      const lotteryBtn = detectLotteryButton();
      if (lotteryBtn) {
        return {
          inQueue: true,
          joinable: true,
          detail: "Lottery application page — ready to apply (抽選応募)",
        };
      }
    }

    // Japanese text-based queue detection
    const bodyText = document.body?.innerText || "";
    if (/ただいまアクセスが集中|待機列|順番にご案内|お待ちください|混雑|waiting/i.test(bodyText)
        && !/カートに入れる|add to cart/i.test(bodyText)) {
      return {
        inQueue: true,
        joinable: false,
        detail: "PC Japan — アクセス集中 (access congestion queue)",
      };
    }

    // Through — product page with ATC
    const atcBtn = findAtcButton();
    if (atcBtn) {
      return { inQueue: false, through: true, detail: "Product page loaded — you're through!" };
    }

    return { inQueue: false, through: false };
  }

  function findAtcButton() {
    for (const sel of ATC_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const txt = (el.textContent || el.value || "");
        if (/カートに入れる|add to (cart|bag)/i.test(txt) && isVisible(el) && !el.disabled) return el;
      }
    }
    const allBtns = document.querySelectorAll("button, input[type='submit']");
    for (const btn of allBtns) {
      const txt = (btn.textContent || btn.value || "");
      if (/カートに入れる|add to (cart|bag)/i.test(txt) && isVisible(btn) && !btn.disabled) return btn;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }

  function join() {
    // On lottery pages, click the apply button
    const lotteryBtn = detectLotteryButton();
    if (lotteryBtn) {
      lotteryBtn.click();
      return true;
    }
    return false;
  }

  function addToCart() {
    const btn = findAtcButton();
    if (!btn) return false;
    btn.click();
    return true;
  }

  // MutationObserver for dynamically injected Incapsula iframes
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
    id: "pokemon-center-jp",
    name: "PC Japan",
    detect,
    join,
    addToCart,
  };
})();
