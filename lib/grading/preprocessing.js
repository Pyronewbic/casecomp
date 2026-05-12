import sharp from "sharp";
import axios from "axios";

const CORNER_RATIO = 0.20;

export async function cropCorners(imageUrl) {
  const res = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 15_000,
    maxRedirects: 5,
  });

  const img = sharp(Buffer.from(res.data));
  const { width, height } = await img.metadata();
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
      const buf = await sharp(Buffer.from(res.data))
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
