import { BoundingBox } from "../types.js";
import { CNN_INPUT_SIZE } from "../constants.js";

const FEATURE_MAP_SIZE = 7;   // MobileNetV2 last layer: 7x7 at 224x224 input
const FEATURE_CHANNELS = 1280;

/**
 * Class Activation Mapping (CAM) — lightweight alternative to Grad-CAM.
 *
 * Uses the feature_map output from the ONNX model (exported before GAP)
 * and the quality head weights to compute per-class saliency.
 *
 * CAM formula:
 *   cam[c, h, w] = sum_k(weight[class][k] * feature_map[k, h, w])
 *
 * @param featureMap  Float32Array [1280, 7, 7] from ONNX output
 * @param classIdx    Predicted quality class index (0=good, 1=acceptable, 2=poor)
 * @param threshold   Normalised saliency threshold for bounding box extraction (0-1)
 */
export function computeCAM(
  featureMap: Float32Array,
  qualityWeights: Float32Array,
  classIdx: number,
  threshold = 0.5
): { heatmap: Float32Array; anomalyRegions: Array<BoundingBox & { confidence: number }> } {
  const H = FEATURE_MAP_SIZE;
  const W = FEATURE_MAP_SIZE;
  const C = FEATURE_CHANNELS;

  // Extract weights for the predicted class
  const classWeights = qualityWeights.slice(classIdx * C, (classIdx + 1) * C);

  // cam[h, w] = Σ_k weight[k] * feature_map[k, h, w]
  const cam = new Float32Array(H * W);

  for (let k = 0; k < C; k++) {
    const w = classWeights[k];
    if (w === 0) continue;
    for (let h = 0; h < H; h++) {
      for (let ww = 0; ww < W; ww++) {
        cam[h * W + ww] += w * featureMap[k * H * W + h * W + ww];
      }
    }
  }

  // ReLU + normalize to [0, 1]
  let maxVal = 0;
  for (let i = 0; i < cam.length; i++) {
    cam[i] = Math.max(0, cam[i]);
    if (cam[i] > maxVal) maxVal = cam[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < cam.length; i++) cam[i] /= maxVal;
  }

  // Extract anomaly regions above threshold (scale back to image coordinates)
  const anomalyRegions = extractRegions(cam, H, W, threshold);

  return { heatmap: cam, anomalyRegions };
}

/** Convert threshold-passing CAM cells to bounding boxes in original image space */
function extractRegions(
  cam: Float32Array,
  H: number,
  W: number,
  threshold: number
): Array<BoundingBox & { confidence: number }> {
  const { width: imgW, height: imgH } = CNN_INPUT_SIZE;
  const cellW = imgW / W;
  const cellH = imgH / H;
  const regions: Array<BoundingBox & { confidence: number }> = [];

  for (let h = 0; h < H; h++) {
    for (let w = 0; w < W; w++) {
      const score = cam[h * W + w];
      if (score >= threshold) {
        regions.push({
          x: Math.round(w * cellW),
          y: Math.round(h * cellH),
          w: Math.round(cellW),
          h: Math.round(cellH),
          confidence: parseFloat(score.toFixed(3)),
        });
      }
    }
  }

  // Merge adjacent cells (simple greedy merge)
  return mergeAdjacentRegions(regions, cellW, cellH);
}

function mergeAdjacentRegions(
  regions: Array<BoundingBox & { confidence: number }>,
  cellW: number,
  cellH: number
): Array<BoundingBox & { confidence: number }> {
  if (regions.length === 0) return [];

  const merged: Array<BoundingBox & { confidence: number }> = [];
  const used = new Set<number>();

  for (let i = 0; i < regions.length; i++) {
    if (used.has(i)) continue;
    let { x, y, w, h, confidence } = regions[i];
    let maxConf = confidence;
    used.add(i);

    for (let j = i + 1; j < regions.length; j++) {
      if (used.has(j)) continue;
      const r = regions[j];
      // Adjacent if within 1 cell distance
      if (
        Math.abs(r.x - (x + w)) <= cellW * 1.5 ||
        Math.abs(r.y - (y + h)) <= cellH * 1.5
      ) {
        x = Math.min(x, r.x);
        y = Math.min(y, r.y);
        w = Math.max(x + w, r.x + r.w) - x;
        h = Math.max(y + h, r.y + r.h) - y;
        maxConf = Math.max(maxConf, r.confidence);
        used.add(j);
      }
    }
    merged.push({ x, y, w, h, confidence: maxConf });
  }

  return merged.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}
