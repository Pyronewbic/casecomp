// One-shot check: is the 2015 PSA year page accessible?
import { firefox } from "playwright";
const TRACKING_BLOCK = ["doubleclick","google-analytics","googletagmanager","fbevents","facebook.net","bat.bing","snapchat.com","reddit.com","quantummetric","stackadapt","branch.io","stape","tapad","zdassets"];
function blockTracking(page) {
  return page.route("**/*", (r) => { TRACKING_BLOCK.some(p => r.request().url().includes(p)) ? r.abort() : r.continue(); });
}
const browser = await firefox.launch({ headless: true });
const ctx = await browser.newContext();
const p = await ctx.newPage();
await blockTracking(p);
await p.goto("https://www.psacard.com/pop/tcg-cards/2015/156941", { waitUntil: "networkidle", timeout: 25000 });
const title = await p.title();
const links = await p.evaluate(() => document.querySelectorAll('a[href*="/pop/tcg-cards/"]').length);
console.log(`title="${title}" links=${links} → ${(title.includes("Just a moment") || links===0) ? "BLOCKED" : "OK"}`);
await browser.close();
