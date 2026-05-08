const TARGET_POLL_MS = 5000;
const tabUrlMap = new Map();

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
  discordChannels: [],
  discordKeywords: [],
  monitorStatus: {},
  pcListings: {},
  redditSeen: [],
  redditSubs: ["PKMNTCGDeals", "PokemonTCG"],
  logArchive: [],
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (existing) => {
    chrome.storage.local.set({ ...DEFAULT_CONFIG, ...existing });
  });
  chrome.alarms.create("csb-reddit-poll", { periodInMinutes: 3 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "csb-reddit-poll") pollReddit();
});

function pollTargets() {
  chrome.tabs.query({}, (allTabs) => {
    const liveTabIds = new Set(allTabs.map((t) => t.id));
    const monitoredTabs = allTabs.filter((t) => t.url && /queue-it\.net|pokemoncenter\.com|pokemoncenter-online|pokemon\.co\.jp|walmart\.com|costco\.com|discord\.com\/channels|x\.com/.test(t.url));
    for (const tab of monitoredTabs) {
      tabUrlMap.set(tab.id, tab.url);
      chrome.tabs.sendMessage(tab.id, { type: "POLL_QUEUE" }).catch(() => {});
    }
    cleanStaleLogs(liveTabIds);
  });
  autoOpenTargets();
}

function cleanStaleLogs(liveTabIds) {
  chrome.storage.local.get(["log", "logArchive"], (data) => {
    const log = data.log || [];
    const keep = [];
    const purged = [];
    for (const e of log) {
      if (e.tabId && !liveTabIds.has(e.tabId)) {
        e.archivedAt = new Date().toISOString();
        e.reason = "tab closed";
        purged.push(e);
      } else {
        keep.push(e);
      }
    }
    if (!purged.length) return;
    const archive = [...purged, ...(data.logArchive || [])].slice(0, 500);
    chrome.storage.local.set({ log: keep, logArchive: archive });
  });
}

setInterval(pollTargets, TARGET_POLL_MS);

chrome.tabs.onRemoved.addListener((tabId) => {
  const closedUrl = tabUrlMap.get(tabId);
  tabUrlMap.delete(tabId);

  chrome.storage.local.get(["log", "logArchive", "targetUrls"], (data) => {
    const log = data.log || [];
    const keep = [];
    const purged = [];
    for (const e of log) {
      const match = e.tabId === tabId || (closedUrl && e.tabUrl === closedUrl);
      if (match) {
        e.archivedAt = new Date().toISOString();
        e.reason = "tab closed";
        purged.push(e);
      } else {
        keep.push(e);
      }
    }

    const updates = { log: keep };

    if (purged.length) {
      updates.logArchive = [...purged, ...(data.logArchive || [])].slice(0, 500);
    }

    if (closedUrl) {
      const targets = (data.targetUrls || []).map((u) => {
        if (u.url === closedUrl || closedUrl.startsWith(u.url) || u.url.startsWith(closedUrl)) {
          return { ...u, active: false };
        }
        return u;
      });
      updates.targetUrls = targets;
    }

    chrome.storage.local.set(updates);
  });
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
          chrome.tabs.create({ url: entry.url, active: false }, (tab) => {
            if (tab) tabUrlMap.set(tab.id, entry.url);
          });
          appendLog("system", "target-opened", `Opened ${entry.label || entry.url}`);
        }
      }
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OPEN_DASHBOARD") {
    const dashUrl = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.query({ url: dashUrl }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: dashUrl });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "QUEUE_STATUS") {
    const tabUrl = sender.tab?.url || "";
    const tabId = sender.tab?.id || null;
    if (tabId && tabUrl) tabUrlMap.set(tabId, tabUrl);
    appendLog(msg.site, msg.status, msg.detail, tabId, tabUrl);
    updateMonitorStatus(msg.site);

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
    } else if (msg.status === "discord-intel") {
      notify("Discord Intel", msg.detail || "Drop alert from Discord");
    } else if (msg.status === "new-listing") {
      notify("New Listing", msg.detail || "New product detected");
    }
    sendResponse({ ok: true });
  }

  if (msg.type === "GET_CONFIG") {
    chrome.storage.local.get(
      ["enabled", "sites", "autoJoin", "autoAddToCart", "soundAlerts", "notifications", "targetUrls", "discordChannels", "discordKeywords", "redditSubs"],
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
    chrome.storage.local.get(["targetUrls", "log", "logArchive"], (data) => {
      const urls = (data.targetUrls || []).filter((u) => u.url !== msg.url);
      const removed = (data.targetUrls || []).find((u) => u.url === msg.url);
      const label = removed?.label || "";
      const keep = [];
      const purged = [];
      for (const e of (data.log || [])) {
        let shouldPurge = false;
        if (e.tabUrl === msg.url) shouldPurge = true;
        if (e.site === "system" && e.detail) {
          if (e.detail.includes(msg.url)) shouldPurge = true;
          if (label && e.detail.includes(label)) shouldPurge = true;
        }
        if (shouldPurge) {
          e.archivedAt = new Date().toISOString();
          e.reason = `target removed: ${label || msg.url}`;
          purged.push(e);
        } else {
          keep.push(e);
        }
      }
      const archive = [...purged, ...(data.logArchive || [])].slice(0, 500);
      chrome.storage.local.set({ targetUrls: urls, log: keep, logArchive: archive });
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

const SITE_NAME_TO_ID = {
  "Pokémon Center": "pokemon-center",
  "Pokemon Center": "pokemon-center",
  "PC Japan": "pokemon-center-jp",
  "Walmart": "walmart",
  "Costco": "costco",
  "discord": "discord",
};

function updateMonitorStatus(site) {
  const id = SITE_NAME_TO_ID[site] || site.toLowerCase().replace(/\s+/g, "-");
  chrome.storage.local.get(["monitorStatus"], (data) => {
    const status = data.monitorStatus || {};
    status[id] = { lastSeen: new Date().toISOString(), active: true };
    chrome.storage.local.set({ monitorStatus: status });
  });
}

async function pollReddit() {
  const data = await new Promise((r) => chrome.storage.local.get(["enabled", "discordKeywords", "redditSeen", "redditSubs"], r));
  if (data.enabled === false) return;
  const keywords = data.discordKeywords || [];
  const subs = data.redditSubs || ["PKMNTCGDeals", "PokemonTCG"];
  const seen = new Set(data.redditSeen || []);
  if (!subs.length) return;

  for (const sub of subs) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=15`, {
        headers: { "User-Agent": "Casecomp/0.4" },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const posts = json?.data?.children || [];

      for (const post of posts) {
        const d = post.data;
        if (!d || seen.has(d.id)) continue;

        const text = `${d.title} ${d.selftext || ""}`.toLowerCase();
        const match = keywords.length === 0 || keywords.some((kw) => text.includes(kw.toLowerCase()));
        if (!match) continue;

        seen.add(d.id);
        appendLog("Reddit", "discord-intel", `r/${sub}: ${d.title.slice(0, 200)}`);
        notify(`Reddit · r/${sub}`, d.title.slice(0, 120));
      }
    } catch {}
  }

  const seenArr = [...seen].slice(-100);
  chrome.storage.local.set({ redditSeen: seenArr });
}

function appendLog(site, status, detail, tabId, tabUrl) {
  chrome.storage.local.get(["log"], (data) => {
    const log = data.log || [];
    const entry = {
      ts: new Date().toISOString(),
      site,
      status,
      detail: detail || "",
    };
    if (tabId) entry.tabId = tabId;
    if (tabUrl) entry.tabUrl = tabUrl;
    log.unshift(entry);
    chrome.storage.local.set({ log: log.slice(0, 200) });
  });
}
