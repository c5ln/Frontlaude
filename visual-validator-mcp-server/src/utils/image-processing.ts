import sharp from "sharp";
import { ANALYSIS_RESOLUTION } from "../constants.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GrayscaleImage {
  data: Buffer;   // 1 byte per pixel
  width: number;
  height: number;
}

export interface RGBImage {
  data: Buffer;   // 3 bytes per pixel (R, G, B)
  width: number;
  height: number;
}

export interface SobelResult {
  gx: Float32Array;   // horizontal gradient → detects vertical edges
  gy: Float32Array;   // vertical gradient   → detects horizontal edges
  mag: Float32Array;  // gradient magnitude
  width: number;
  height: number;
}

// ─── Sharp wrappers ───────────────────────────────────────────────────────────

/** Resize to analysis resolution + grayscale, returns single-channel raw buffer */
export async function toAnalysisGrayscale(pngBuffer: Buffer): Promise<GrayscaleImage> {
  const { data, info } = await sharp(pngBuffer)
    .resize(ANALYSIS_RESOLUTION.width, ANALYSIS_RESOLUTION.height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

/** Resize to analysis resolution + RGB (no alpha), returns 3-channel raw buffer */
export async function toAnalysisRGB(pngBuffer: Buffer): Promise<RGBImage> {
  const { data, info } = await sharp(pngBuffer)
    .resize(ANALYSIS_RESOLUTION.width, ANALYSIS_RESOLUTION.height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

// ─── Pixel accessors ──────────────────────────────────────────────────────────

export function getGrayPixel(img: GrayscaleImage, x: number, y: number): number {
  return img.data[y * img.width + x] ?? 0;
}

export function getRGBPixel(img: RGBImage, x: number, y: number): [number, number, number] {
  const idx = (y * img.width + x) * 3;
  return [img.data[idx] ?? 0, img.data[idx + 1] ?? 0, img.data[idx + 2] ?? 0];
}

// ─── Sobel edge detection ─────────────────────────────────────────────────────

/**
 * Apply Sobel operator to a grayscale image.
 * Returns gx (vertical edges), gy (horizontal edges), mag (combined).
 * Values are raw (not clamped to 0-255) for precision in downstream analysis.
 */
export function applySobelXY(gray: GrayscaleImage): SobelResult {
  const { data, width, height } = gray;
  const n = width * height;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const tl = data[(y - 1) * width + (x - 1)];
      const tc = data[(y - 1) * width + x];
      const tr = data[(y - 1) * width + (x + 1)];
      const ml = data[y * width + (x - 1)];
      const mr = data[y * width + (x + 1)];
      const bl = data[(y + 1) * width + (x - 1)];
      const bc = data[(y + 1) * width + x];
      const br = data[(y + 1) * width + (x + 1)];

      const gxVal = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gyVal = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const idx = y * width + x;

      gx[idx] = Math.abs(gxVal);
      gy[idx] = Math.abs(gyVal);
      mag[idx] = Math.sqrt(gxVal * gxVal + gyVal * gyVal);
    }
  }

  return { gx, gy, mag, width, height };
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

export function computeVariance(data: Buffer | Float32Array): { mean: number; stdDev: number } {
  const n = data.length;
  if (n === 0) return { mean: 0, stdDev: 0 };

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return { mean, stdDev: Math.sqrt(Math.max(0, variance)) };
}

/** Find local maxima in a 1-D array above a threshold, with minimum distance between peaks */
export function findPeaks(
  arr: Float32Array,
  minValue: number,
  minDistance: number
): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (arr[i] <= minValue) continue;
    if (arr[i] <= arr[i - 1] || arr[i] < arr[i + 1]) continue;

    // Ensure minimum distance from last peak
    if (peaks.length > 0 && i - peaks[peaks.length - 1] < minDistance) {
      // Keep the stronger one
      if (arr[i] > arr[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
    } else {
      peaks.push(i);
    }
  }
  return peaks;
}
