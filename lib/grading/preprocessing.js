import sharp from "sharp";
import axios from "axios";
import { URL } from "url";
import dns from "dns/promises";
import net from "net";

const CORNER_RATIO = 0.20;
const CARD_AREA_THRESHOLD = 0.80;

const BLOCKED_HOSTS = new Set(["metadata.google.internal", "169.254.169.254"]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  }
  return false;
}

async function validateImageUrl(imageUrl) {
  let parsed;
  try { parsed = new URL(imageUrl); } catch { throw new Error("Invalid image URL"); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Image URL must use HTTP(S)");
  if (BLOCKED_HOSTS.has(parsed.hostname)) throw new Error("Blocked host");
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) throw new Error("Blocked host");
  } else {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIp(address)) throw new Error("Blocked host");
  }
}

const DETECT_PROMPT = `Locate the trading card in this photo. Return the bounding box as JSON with pixel coordinates.

If the card fills the entire image (no visible background), return {"fills_frame": true}.

Otherwise return the tightest rectangle that contains the card:
{"x": <left edge px>, "y": <top edge px>, "width": <px>, "height": <px>}

Respond ONLY with valid JSON, no markdown.`;

export async function detectAndCropCard(imageUrl, apiKey, model) {
  if (!apiKey) return { imageUrl, cropped: false };

  await validateImageUrl(imageUrl);
  const imgRes = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15_000,
    maxRedirects: 5,
  });
  const imgBuf = Buffer.from(imgRes.data);
  const { width, height } = await sharp(imgBuf).metadata();
  if (!width || !height) return { imageUrl, cropped: false };

  const res = await axios.post("https://api.anthropic.com/v1/messages", {
    model: model || "claude-sonnet-4-6",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "text", text: DETECT_PROMPT },
      ],
    }],
  }, {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    timeout: 30_000,
  });

  const text = (res.data?.content || []).map(b => b.type === "text" ? b.text : "").join("");
  const usage = res.data?.usage || {};
  const tokens = { input: usage.input_tokens || 0, output: usage.output_tokens || 0 };

  let bounds;
  try {
    const cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    bounds = JSON.parse(cleaned);
  } catch {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  if (bounds.fills_frame) {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  const bx = Math.max(0, Math.round(bounds.x || 0));
  const by = Math.max(0, Math.round(bounds.y || 0));
  const bw = Math.min(Math.round(bounds.width || width), width - bx);
  const bh = Math.min(Math.round(bounds.height || height), height - by);

  const cardArea = bw * bh;
  const imageArea = width * height;
  if (cardArea / imageArea >= CARD_AREA_THRESHOLD) {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  if (bw < 100 || bh < 100) {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  const croppedBuf = await sharp(imgBuf)
    .extract({ left: bx, top: by, width: bw, height: bh })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    buffer: croppedBuf,
    base64: croppedBuf.toString("base64"),
    mediaType: "image/jpeg",
    bounds: { x: bx, y: by, width: bw, height: bh },
    originalSize: { width, height },
    cropped: true,
    _tokens: tokens,
  };
}

async function fetchImageBuffer(imageUrl) {
  await validateImageUrl(imageUrl);
  const res = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15_000,
    maxRedirects: 5,
  });
  return Buffer.from(res.data);
}

export async function cropCorners(imageUrlOrBuffer) {
  const imgBuf = Buffer.isBuffer(imageUrlOrBuffer)
    ? imageUrlOrBuffer
    : await fetchImageBuffer(imageUrlOrBuffer);

  const { width, height } = await sharp(imgBuf).metadata();
  if (!width || !height) throw new Error("could not read image dimensions");

  const cw = Math.round(width * CORNER_RATIO);
  const ch = Math.round(height * CORNER_RATIO);

  const regions = [
    { name: "top-left", left: 0, top: 0 },
    { name: "top-right", left: width - cw, top: 0 },
    { name: "bottom-left", left: 0, top: height - ch },
    { name: "bottom-right", left: width - cw, top: height - ch },
  ];

  const crops = await Promise.all(
    regions.map(async (r) => {
      const buf = await sharp(imgBuf)
        .extract({ left: r.left, top: r.top, width: cw, height: ch })
        .jpeg({ quality: 90 })
        .toBuffer();
      return {
        name: r.name,
        base64: buf.toString("base64"),
        mediaType: "image/jpeg",
      };
    }),
  );

  return crops;
}

export function cornerCropsToImageBlocks(crops) {
  return crops.map((c) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: c.mediaType,
      data: c.base64,
    },
  }));
}

export function imageBlockFromUrl(url) {
  return { type: "image", source: { type: "url", url } };
}

export function imageBlockFromBase64(base64, mediaType = "image/jpeg") {
  return { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
}
