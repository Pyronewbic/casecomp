(() => {
  const CODE_INPUT_SELECTORS = [
    'input[data-testid="verification-code"]',
    'input[name="verificationCode"]',
    'input[placeholder*="code"]',
    'input[placeholder*="Code"]',
    'input[aria-label*="verification"]',
    'input[type="tel"][maxlength="6"]',
    'input[inputmode="numeric"][maxlength="6"]',
  ];

  // Listen for code from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "FILL_VERIFICATION_CODE" && msg.code) {
      fillCode(msg.code);
    }
  });

  function fillCode(code) {
    for (const sel of CODE_INPUT_SELECTORS) {
      const input = document.querySelector(sel);
      if (input && isVisible(input)) {
        // Set value with native input event for React
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, code);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        chrome.runtime.sendMessage({
          type: "QUEUE_STATUS",
          site: "system",
          status: "verification-filled",
          detail: "Auto-filled verification code: " + code.slice(0, 2) + "****",
        });
        return true;
      }
    }
    return false;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
  }
})();
