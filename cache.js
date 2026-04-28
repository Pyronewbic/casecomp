import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export function cachePath(name) {
  return path.join(ROOT, name);
}

export async function readJsonCache(file, ttlMs = 0) {
  try {
    const raw = await fs.readFile(cachePath(file), "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const now = Date.now();
    if (data._expiresAt && data._expiresAt < now) return null;
    if (
      !data._expiresAt &&
      ttlMs > 0 &&
      data._writtenAt &&
      now - data._writtenAt > ttlMs
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function writeJsonCache(file, entries) {
  const payload = { ...entries, _writtenAt: Date.now() };
  await fs.writeFile(cachePath(file), JSON.stringify(payload, null, 2), "utf8");
}

export function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

export async function bustCaches(files) {
  for (const f of files) {
    try {
      await fs.unlink(cachePath(f));
    } catch {
      /* ignore */
    }
  }
}
