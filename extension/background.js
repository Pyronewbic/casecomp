const ALARM_NAME = "csb-queue-keepalive";
const POLL_INTERVAL_MINUTES = 0.5;

const DEFAULT_CONFIG = {
  enabled: true,
  sites: {
    "pokemon-center": true,
    "pokemon-center-jp": true,
    walmart: true,
    costco: true,
  },
  autoJoin: true,
  autoAddToCart: false,
  soundAlerts: true,
  notifications: true,
  targetUrls: [],
  log: [],
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (existing) => {
    chrome.storage.local.set({ ...DEFAULT_CONFIG, ...existing });
  });
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  chrome.tabs.query({ url: ["https://*.queue-it.net/*", "https://www.pokemoncenter.com/*", "https://www.pokemoncenter-online.com/*", "https://pokemoncenter.pokemon.co.jp/*", "https://www.walmart.com/*", "https://www.costco.com/*"] }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: "POLL_QUEUE" }).catch(() => {});
    }
  });

  autoOpenTargets();
});

function autoOpenTargets() {
  chrome.storage.local.get(["enabled", "targetUrls"], (data) => {
    if (!data.enabled) return;
    const targets = data.targetUrls || [];
    if (!targets.length) return;

    chrome.tabs.query({}, (allTabs) => {
      const openUrls = new Set(allTabs.map((t) => t.url));
      for (const entry of targets) {
        if (!entry.active) continue;
        const alreadyOpen = allTabs.some((t) => t.url && t.url.startsWith(entry.url));
        if (!alreadyOpen) {
          chrome.tabs.create({ url: entry.url, active: false });
          appendLog("system", "target-opened", `Opened ${entry.label || entry.url}`);
        }
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "QUEUE_STATUS") {
    appendLog(msg.site, msg.status, msg.detail);

    if (msg.status === "through") {
      notify(`${msg.site}: You're through the queue!`, msg.detail || "Go go go!");
    } else if (msg.status === "joined") {
      notify(`${msg.site}: Joined queue`, msg.detail || "Waiting in line...");
    } else if (msg.status === "captcha") {
      notify(`${msg.site}: CAPTCHA detected!`, msg.detail || "Manual solve needed — switch to tab now!");
    } else if (msg.status === "atc-success") {
      notify(`${msg.site}: Added to cart!`, msg.detail || "Item added — go checkout!");
    } else if (msg.status === "atc-failed") {
      notify(`${msg.site}: Add-to-cart failed`, msg.detail || "Could not find ATC button");
    }
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_CONFIG") {
    chrome.storage.local.get(
      ["enabled", "sites", "autoJoin", "autoAddToCart", "soundAlerts", "notifications", "targetUrls"],
      (data) => sendResponse(data),
    );
    return true;
  }

  if (msg.type === "ADD_TARGET_URL") {
    chrome.storage.local.get(["targetUrls"], (data) => {
      const urls = data.targetUrls || [];
      const exists = urls.some((u) => u.url === msg.url);
      if (!exists) {
        urls.push({ url: msg.url, label: msg.label || "", active: true, addedAt: new Date().toISOString() });
        chrome.storage.local.set({ targetUrls: urls });
      }
      sendResponse({ ok: true, urls });
    });
    return true;
  }

  if (msg.type === "REMOVE_TARGET_URL") {
    chrome.storage.local.get(["targetUrls"], (data) => {
      const urls = (data.targetUrls || []).filter((u) => u.url !== msg.url);
      chrome.storage.local.set({ targetUrls: urls });
      sendResponse({ ok: true, urls });
    });
    return true;
  }

  if (msg.type === "TOGGLE_TARGET_URL") {
    chrome.storage.local.get(["targetUrls"], (data) => {
      const urls = data.targetUrls || [];
      const entry = urls.find((u) => u.url === msg.url);
      if (entry) entry.active = !entry.active;
      chrome.storage.local.set({ targetUrls: urls });
      sendResponse({ ok: true, urls });
    });
    return true;
  }
});

function notify(title, body) {
  chrome.storage.local.get(["notifications"], (data) => {
    if (data.notifications === false) return;
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message: body,
      priority: 2,
      requireInteraction: true,
    });
  });
}

function appendLog(site, status, detail) {
  chrome.storage.local.get(["log"], (data) => {
    const log = data.log || [];
    log.unshift({
      ts: new Date().toISOString(),
      site,
      status,
      detail: detail || "",
    });
    chrome.storage.local.set({ log: log.slice(0, 200) });
  });
}
