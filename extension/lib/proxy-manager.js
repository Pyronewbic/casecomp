// Proxy manager for Casecomp extension
// Used by background.js — do not import, load via manifest or inline.
// MV3 service workers cannot use chrome.webRequest.onAuthRequired with asyncBlocking,
// so proxy auth must be handled externally (use a proxy that does not require auth,
// or use a separate proxy auth extension alongside).

function applyProxyConfig() {
  chrome.storage.local.get(["proxyConfig"], (data) => {
    const cfg = data.proxyConfig;
    if (!cfg?.enabled || !cfg.host) {
      chrome.proxy.settings.clear({ scope: "regular" });
      return;
    }
    chrome.proxy.settings.set({
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: cfg.type || "http",
            host: cfg.host,
            port: parseInt(cfg.port) || 8080,
          },
        },
      },
      scope: "regular",
    });
  });
}

function clearProxy() {
  chrome.proxy.settings.clear({ scope: "regular" });
}
