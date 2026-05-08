// IMAP Monitor stub for Casecomp extension
// Chrome extensions cannot use raw IMAP sockets directly.
// This module provides the interface for a local IMAP bridge proxy.
//
// Users need to run a local IMAP bridge server that:
// 1. Connects to their IMAP server
// 2. Monitors inbox for verification emails from Walmart/Pokemon Center
// 3. Extracts OTP/verification codes
// 4. Exposes them via HTTP endpoint
//
// The background script polls the bridge and sends codes to content scripts
// via chrome.runtime.sendMessage({ type: "FILL_VERIFICATION_CODE", code }).

// Verification email subject patterns
var IMAP_VERIFICATION_PATTERNS = [
  { site: "walmart", subject: /walmart.*verif|walmart.*code|walmart.*confirm/i },
  { site: "pokemon-center", subject: /pokemon.*center.*verif|pokemon.*center.*code/i },
];

// OTP extraction patterns from email body
var IMAP_CODE_PATTERNS = [
  /\b(\d{6})\b/,
  /code[:\s]+(\d{4,8})/i,
  /verification[:\s]+(\d{4,8})/i,
  /OTP[:\s]+(\d{4,8})/i,
];

function extractVerificationCode(bodyText) {
  for (var i = 0; i < IMAP_CODE_PATTERNS.length; i++) {
    var m = bodyText.match(IMAP_CODE_PATTERNS[i]);
    if (m) return m[1];
  }
  return null;
}
