import sharp from "sharp";
import { CNN_INPUT_SIZE } from "../constants.js";

// ImageNet normalization constants
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * Convert a PNG Buffer to a Float32Array tensor in NCHW format: [1, 3, 224, 224].
 * Applies ImageNet normalization (same as torchvision transforms used during training).
 */
export async function imageToTensor(pngBuffer: Buffer): Promise<Float32Array> {
  const { width, height } = CNN_INPUT_SIZE;

  // Resize + extract raw RGB (3 channels, no alpha)
  const { data } = await sharp(pngBuffer)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // data layout: [R, G, B, R, G, B, ...] = HWC
  // Target layout: NCHW = [1, 3, H, W]
  const n = width * height;
  const tensor = new Float32Array(3 * n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;

    // Channel-first (NCHW): C=0→R, C=1→G, C=2→B
    tensor[0 * n + i] = (r - MEAN[0]) / STD[0];
    tensor[1 * n + i] = (g - MEAN[1]) / STD[1];
    tensor[2 * n + i] = (b - MEAN[2]) / STD[2];
  }

  return tensor;
}
