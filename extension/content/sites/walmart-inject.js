// Runs in MAIN world — patches fetch/XHR to intercept validateTickets responses.
// Posts queue ticket data to the window so the ISOLATED content script can relay it.

const TARGET = "validateTickets";

const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const response = await originalFetch.apply(this, args);
  try {
    const url = (args[0] instanceof Request ? args[0].url : args[0]) || "";
    if (typeof url === "string" && url.includes(TARGET)) {
      const clone = response.clone();
      const json = await clone.json();
      window.postMessage({ type: "CSB_WALMART_QUEUE", payload: json }, window.location.origin);
    }
  } catch {}
  return response;
};

const xhrOpen = XMLHttpRequest.prototype.open;
const xhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this._csbUrl = url;
  return xhrOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (...args) {
  if (this._csbUrl && this._csbUrl.includes(TARGET)) {
    this.addEventListener("load", function () {
      try {
        const json = JSON.parse(this.responseText);
        window.postMessage({ type: "CSB_WALMART_QUEUE", payload: json }, window.location.origin);
      } catch {}
    });
  }
  return xhrSend.apply(this, args);
};
