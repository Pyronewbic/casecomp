(() => {
  let keywords = [];
  let seenIds = new Set();
  let observer = null;

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (data) => resolve(data || {}));
    });
  }

  async function init() {
    const config = await getConfig();
    keywords = config.discordKeywords || [];
    if (!keywords.length) return;
    waitForTimeline();
  }

  function waitForTimeline() {
    const timeline = document.querySelector('[data-testid="primaryColumn"]');
    if (timeline) {
      attach(timeline);
    } else {
      setTimeout(waitForTimeline, 1500);
    }
  }

  function attach(column) {
    if (observer) observer.disconnect();

    scanVisible(column);

    observer = new MutationObserver(() => scanVisible(column));
    observer.observe(column, { childList: true, subtree: true });
  }

  function scanVisible(column) {
    const tweets = column.querySelectorAll('[data-testid="tweet"]');
    for (const tweet of tweets) {
      processTweet(tweet);
    }
  }

  function processTweet(tweet) {
    const tweetText = tweet.querySelector('[data-testid="tweetText"]');
    if (!tweetText) return;

    const id = getTweetId(tweet);
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    if (seenIds.size > 200) {
      const arr = [...seenIds];
      seenIds = new Set(arr.slice(-100));
    }

    const text = tweetText.textContent.trim();
    if (!matchesKeywords(text)) return;

    const author = getAuthor(tweet);
    chrome.runtime.sendMessage({
      type: "QUEUE_STATUS",
      site: "X",
      status: "discord-intel",
      detail: `@${author}: "${text.slice(0, 200)}"`,
    });
  }

  function getTweetId(tweet) {
    const link = tweet.querySelector('a[href*="/status/"]');
    if (link) {
      const m = link.href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    const text = tweet.querySelector('[data-testid="tweetText"]');
    return text ? text.textContent.slice(0, 60) : null;
  }

  function getAuthor(tweet) {
    const link = tweet.querySelector('a[role="link"][href^="/"]');
    if (link) {
      const handle = link.getAttribute("href").replace(/^\//, "").split("/")[0];
      if (handle && !handle.includes(" ")) return handle;
    }
    return "unknown";
  }

  function matchesKeywords(text) {
    const lower = text.toLowerCase();
    return keywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  init();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.discordKeywords) {
      keywords = changes.discordKeywords.newValue || [];
    }
  });
})();
