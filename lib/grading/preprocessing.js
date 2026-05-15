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

const DETECT_PROMPT = `Locate the trading card in this photo. Return the four corner positions as JSON with pixel coordinates.

If the card fills the entire image (no visible background), return {"fills_frame": true}.

Otherwise return the four corners of the card (not the bounding box — the actual card corners, even if tilted):
{"topLeft": {"x": <px>, "y": <px>}, "topRight": {"x": <px>, "y": <px>}, "bottomLeft": {"x": <px>, "y": <px>}, "bottomRight": {"x": <px>, "y": <px>}}

Respond ONLY with valid JSON, no markdown.`;

export function parseAnthropicResponse(data) {
  const text = (data?.content || []).map(b => b.type === "text" ? b.text : "").join("");
  const usage = data?.usage || {};
  return { text, tokens: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 } };
}

export function parseTogetherResponse(data) {
  const text = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage || {};
  return { text, tokens: { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 } };
}

async function callDetectAnthropicApi(imageUrl, apiKey, model) {
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
  return parseAnthropicResponse(res.data);
}

async function callDetectTogetherApi(imageBase64, apiKey, model) {
  const res = await axios.post("https://api.together.xyz/v1/chat/completions", {
    model: model || "zai-org/GLM-4.6V-Flash",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        { type: "text", text: DETECT_PROMPT },
      ],
    }],
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    timeout: 30_000,
  });
  return parseTogetherResponse(res.data);
}

export async function detectAndCropCard(imageUrl, apiKey, model, opts = {}) {
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

  let text, tokens;
  if (opts.provider === "together" && opts.togetherKey) {
    const b64 = imgBuf.toString("base64");
    ({ text, tokens } = await callDetectTogetherApi(b64, opts.togetherKey, opts.togetherModel));
  } else {
    ({ text, tokens } = await callDetectAnthropicApi(imageUrl, apiKey, model));
  }

  let parsed;
  try {
    const cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  if (parsed.fills_frame) {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  let bx, by, bw, bh, tiltDeg = 0;
  if (parsed.topLeft && parsed.topRight && parsed.bottomLeft && parsed.bottomRight) {
    const tl = parsed.topLeft, tr = parsed.topRight, bl = parsed.bottomLeft, br = parsed.bottomRight;
    const topAngle = Math.atan2(tr.y - tl.y, tr.x - tl.x);
    const bottomAngle = Math.atan2(br.y - bl.y, br.x - bl.x);
    tiltDeg = ((topAngle + bottomAngle) / 2) * (180 / Math.PI);
    if (Math.abs(tiltDeg) > 30) tiltDeg = 0;

    const xs = [tl.x, tr.x, bl.x, br.x];
    const ys = [tl.y, tr.y, bl.y, br.y];
    bx = Math.max(0, Math.round(Math.min(...xs)));
    by = Math.max(0, Math.round(Math.min(...ys)));
    const bx2 = Math.min(width, Math.round(Math.max(...xs)));
    const by2 = Math.min(height, Math.round(Math.max(...ys)));
    bw = bx2 - bx;
    bh = by2 - by;
  } else {
    bx = Math.max(0, Math.round(parsed.x || 0));
    by = Math.max(0, Math.round(parsed.y || 0));
    bw = Math.min(Math.round(parsed.width || width), width - bx);
    bh = Math.min(Math.round(parsed.height || height), height - by);
  }

  const cardArea = bw * bh;
  const imageArea = width * height;
  if (cardArea / imageArea >= CARD_AREA_THRESHOLD) {
    return { imageUrl, cropped: false, tiltDeg, _tokens: tokens };
  }

  if (bw < 100 || bh < 100) {
    return { imageUrl, cropped: false, _tokens: tokens };
  }

  let pipeline = sharp(imgBuf);
  if (Math.abs(tiltDeg) > 0.5) {
    pipeline = pipeline.rotate(-tiltDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const rotated = await pipeline.toBuffer();
    const rotMeta = await sharp(rotated).metadata();
    const dx = (rotMeta.width - width) / 2;
    const dy = (rotMeta.height - height) / 2;
    const rx = Math.max(0, Math.round(bx + dx));
    const ry = Math.max(0, Math.round(by + dy));
    const rw = Math.min(bw, rotMeta.width - rx);
    const rh = Math.min(bh, rotMeta.height - ry);
    if (rw > 50 && rh > 50) {
      pipeline = sharp(rotated).extract({ left: rx, top: ry, width: rw, height: rh });
    } else {
      pipeline = sharp(imgBuf).extract({ left: bx, top: by, width: bw, height: bh });
    }
  } else {
    pipeline = pipeline.extract({ left: bx, top: by, width: bw, height: bh });
  }

  const croppedBuf = await pipeline.jpeg({ quality: 92 }).toBuffer();

  return {
    buffer: croppedBuf,
    base64: croppedBuf.toString("base64"),
    mediaType: "image/jpeg",
    bounds: { x: bx, y: by, width: bw, height: bh },
    tiltDeg: Math.round(tiltDeg * 100) / 100,
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
