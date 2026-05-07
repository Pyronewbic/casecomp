import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3099;

const PAGES = {
  "/":                   "harness.html",
  "/pokemon-center":     "pokemon-center-queue.html",
  "/pokemon-center/through": "pokemon-center-through.html",
  "/walmart":            "walmart-queue.html",
  "/walmart/through":    "walmart-through.html",
  "/costco":             "costco-queue.html",
  "/costco/through":     "costco-through.html",
  "/pokemon-center-jp":  "pokemon-center-jp-queue.html",
  "/pokemon-center-jp/through": "pokemon-center-jp-through.html",
  "/queue-it":           "queue-it.html",
  "/captcha":            "captcha.html",
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const file = PAGES[url.pathname];
  if (!file) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const html = readFileSync(join(__dirname, file), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Queue test harness: http://localhost:${PORT}\n`);
  console.log("  Pages:");
  for (const [path, file] of Object.entries(PAGES)) {
    console.log(`    http://localhost:${PORT}${path}  →  ${file}`);
  }
  console.log();
});
