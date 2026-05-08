(() => {
  if (window.__csbQueueMonitorLoaded) return;
  window.__csbQueueMonitorLoaded = true;

  const SITE_HANDLER = window.__csbSiteHandler;
  if (!SITE_HANDLER) return;

  let lastStatus = null;
  let chimePlayedForThrough = false;

  function report(status, detail) {
    if (status === lastStatus) return;
    lastStatus = status;
    chrome.runtime.sendMessage({
      type: "QUEUE_STATUS",
      site: SITE_HANDLER.name,
      status,
      detail,
    });
  }

  let audioCtx = null;
  let userGestured = false;

  function onUserGesture() {
    if (userGestured) return;
    userGestured = true;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    document.removeEventListener("click", onUserGesture, true);
    document.removeEventListener("keydown", onUserGesture, true);
  }
  document.addEventListener("click", onUserGesture, true);
  document.addEventListener("keydown", onUserGesture, true);

  async function getReadyCtx() {
    if (!userGestured) return null;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch { return null; }
    }
    if (audioCtx.state !== "running") return null;
    return audioCtx;
  }

  async function playChime() {
    try {
      const ctx = await getReadyCtx();
      if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.4);
      });
    } catch {}
  }

  async function playUrgentChime() {
    try {
      const ctx = await getReadyCtx();
      if (!ctx) return;
      for (let rep = 0; rep < 3; rep++) {
        const offset = rep * 0.6;
        [880, 1108.73, 880].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.2, ctx.currentTime + offset + i * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + i * 0.1 + 0.15);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + offset + i * 0.1);
          osc.stop(ctx.currentTime + offset + i * 0.1 + 0.15);
        });
      }
    } catch {}
  }

  let lastUrl = window.location.href;
  let urlChangedAt = 0;

  function checkUrlChange() {
    const current = window.location.href;
    if (current !== lastUrl) {
      lastUrl = current;
      lastStatus = null;
      chimePlayedForThrough = false;
      urlChangedAt = Date.now();
    }
  }

  function isTargetUrl(config) {
    const targets = config.targetUrls || [];
    if (!targets.length) return true;
    const current = window.location.href;
    return targets.some((t) => t.active && current.startsWith(t.url));
  }

  async function tick() {
    checkUrlChange();
    let config;
    try {
      config = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
    } catch {
      return;
    }
    if (!config?.enabled) return;
    if (!config.sites?.[SITE_HANDLER.id]) return;

    const state = SITE_HANDLER.detect();

    if (state.captcha) {
      report("captcha", state.detail || "CAPTCHA detected — manual solve needed!");
      if (config.soundAlerts) playUrgentChime();
      return;
    }

    if (!state.inQueue) {
      if (state.through) {
        report("through", state.detail);
        if (config.soundAlerts && !chimePlayedForThrough) {
          chimePlayedForThrough = true;
          playChime();
        }

        if (config.autoAddToCart && SITE_HANDLER.addToCart && lastStatus !== "atc-success" && lastStatus !== "checkout-shipping" && lastStatus !== "checkout-payment" && lastStatus !== "checkout-review" && lastStatus !== "checkout-success") {
          const sincNav = Date.now() - urlChangedAt;
          if (urlChangedAt && sincNav < 1000) return;
          const atcOk = SITE_HANDLER.addToCart();
          if (atcOk) {
            report("atc-success", "Auto-added to cart!");
            if (config.soundAlerts) playChime();

            // Auto-checkout after ATC if enabled
            if (config.autoCheckout && SITE_HANDLER.checkout) {
              setTimeout(() => {
                SITE_HANDLER.checkout();
              }, 1000);
            }
          }
        }
      }
      return;
    }

    chimePlayedForThrough = false;
    report("detected", state.detail || "Queue detected");

    if (config.autoJoin && state.joinable) {
      const joined = SITE_HANDLER.join();
      if (joined) {
        report("joined", "Auto-joined queue");
      }
    }

    if (state.position) {
      report("waiting", `Position: ${state.position}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "POLL_QUEUE") tick();
  });

  const isPokemonCenter = /pokemoncenter/i.test(window.location.hostname);
  const TICK_MS = isPokemonCenter ? 5000 : 2000;

  tick();
  setInterval(tick, TICK_MS);
})();
