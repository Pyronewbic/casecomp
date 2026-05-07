(() => {
  const DROP_KEYWORDS_DEFAULT = [];

  let watchChannels = [];
  let keywords = DROP_KEYWORDS_DEFAULT;
  let currentChannel = null;
  let observer = null;
  let seenIds = new Set();
  let lastPath = location.pathname;

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (data) => resolve(data || {}));
    });
  }

  async function init() {
    const config = await getConfig();
    if (config.sites?.discord === false) return;
    watchChannels = config.discordChannels || [];
    keywords = config.discordKeywords || DROP_KEYWORDS_DEFAULT;
    tryAttach();
    setInterval(checkNavigation, 2000);
  }

  function getChannelName() {
    const h1 = document.querySelector('h1[class*="title"], [class*="channelName"] h1, h1');
    if (!h1) return null;
    return h1.textContent.trim().toLowerCase().replace(/^#/, "");
  }

  function isWatchedChannel(name) {
    if (!name) return false;
    return watchChannels.some((ch) => name.includes(ch.toLowerCase()));
  }

  function getMessageList() {
    return document.querySelector('ol[data-list-id="chat-messages"]');
  }

  function tryAttach() {
    const name = getChannelName();
    currentChannel = name;

    if (!isWatchedChannel(name)) {
      detach();
      return;
    }

    const list = getMessageList();
    if (!list) {
      setTimeout(tryAttach, 1000);
      return;
    }

    detach();
    seenIds = new Set();

    list.querySelectorAll('li[id^="chat-messages-"]').forEach((li) => seenIds.add(li.id));

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          processMessage(node);
        }
      }
    });
    observer.observe(list, { childList: true });
  }

  function detach() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function processMessage(node) {
    const msgId = node.id || "";
    if (!msgId || seenIds.has(msgId)) return;
    seenIds.add(msgId);
    if (seenIds.size > 100) {
      const arr = [...seenIds];
      seenIds = new Set(arr.slice(-50));
    }

    const content = node.querySelector('[id^="message-content-"]');
    if (!content) return;

    const text = content.textContent.trim();
    if (!matchesKeywords(text)) return;

    chrome.runtime.sendMessage({
      type: "QUEUE_STATUS",
      site: "discord",
      status: "discord-intel",
      detail: `#${currentChannel}: "${text.slice(0, 200)}"`,
    });
  }

  function matchesKeywords(text) {
    const lower = text.toLowerCase();
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  function checkNavigation() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    setTimeout(tryAttach, 500);
  }

  init();
})();
