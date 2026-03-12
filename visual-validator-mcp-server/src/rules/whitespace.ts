import { RuleResult, BoundingBox } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisGrayscale } from "../utils/image-processing.js";

// Pixel is "background" if its grayscale value is above this
const BACKGROUND_THRESHOLD = 238;
// Whitespace ratio thresholds
const WHITESPACE_RATIO_ERROR   = 0.93;  // >93% whitespace → basically empty
const WHITESPACE_RATIO_WARNING = 0.82;  // >82% whitespace → very sparse layout
// Quadrant imbalance: difference in content ratio between opposing quadrants
const IMBALANCE_ERROR   = 0.55;  // one quadrant has 55% more content than its opposite
const IMBALANCE_WARNING = 0.30;

export class WhitespaceRule implements BaseRule {
  readonly id = "whitespace";
  readonly description =
    "Detects excessive or unbalanced whitespace by analysing content density and quadrant balance.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const gray = await toAnalysisGrayscale(pngBuffer);
    const { data, width, height } = gray;

    // Overall content/whitespace ratio
    let bgCount = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] >= BACKGROUND_THRESHOLD) bgCount++;
    }
    const whitespaceRatio = bgCount / data.length;
    const contentRatio    = 1 - whitespaceRatio;

    // Quadrant content densities (top-left, top-right, bottom-left, bottom-right)
    const qDensities = quadrantDensities(data, width, height);
    const imbalanceH = quadrantImbalance(qDensities, "horizontal"); // left vs right
    const imbalanceV = quadrantImbalance(qDensities, "vertical");   // top vs bottom
    const maxImbalance = Math.max(imbalanceH, imbalanceV);

    const details = {
      whitespaceRatio: parseFloat((whitespaceRatio * 100).toFixed(1)),
      contentRatio:    parseFloat((contentRatio    * 100).toFixed(1)),
      quadrantDensities: {
        topLeft:     parseFloat((qDensities[0] * 100).toFixed(1)),
        topRight:    parseFloat((qDensities[1] * 100).toFixed(1)),
        bottomLeft:  parseFloat((qDensities[2] * 100).toFixed(1)),
        bottomRight: parseFloat((qDensities[3] * 100).toFixed(1)),
      },
      horizontalImbalance: parseFloat((imbalanceH * 100).toFixed(1)),
      verticalImbalance:   parseFloat((imbalanceV * 100).toFixed(1)),
    };

    // Excessive whitespace check
    if (whitespaceRatio > WHITESPACE_RATIO_ERROR) {
      return error(
        this.id,
        `Excessive whitespace: ${(whitespaceRatio * 100).toFixed(0)}% of the screen is empty`,
        details
      );
    }
    if (whitespaceRatio > WHITESPACE_RATIO_WARNING) {
      return warn(
        this.id,
        `Very sparse layout: ${(whitespaceRatio * 100).toFixed(0)}% whitespace`,
        details
      );
    }

    // Layout balance check
    if (maxImbalance > IMBALANCE_ERROR) {
      const axis = imbalanceH > imbalanceV ? "left/right" : "top/bottom";
      return warn(
        this.id,
        `Unbalanced layout: significant content imbalance along ${axis} axis (${(maxImbalance * 100).toFixed(0)}%)`,
        details,
        imbalanceRegions(qDensities, width, height)
      );
    }
    if (maxImbalance > IMBALANCE_WARNING) {
      const axis = imbalanceH > imbalanceV ? "left/right" : "top/bottom";
      return warn(
        this.id,
        `Slightly unbalanced layout along ${axis} axis (${(maxImbalance * 100).toFixed(0)}%)`,
        details
      );
    }

    return pass(
      this.id,
      `Whitespace balanced (${(whitespaceRatio * 100).toFixed(0)}% whitespace, imbalance ${(maxImbalance * 100).toFixed(0)}%)`,
      details
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns content density [0,1] for each quadrant: [TL, TR, BL, BR] */
function quadrantDensities(data: Buffer, w: number, h: number): [number, number, number, number] {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);

  const counts = [0, 0, 0, 0];
  const totals = [0, 0, 0, 0];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const qIdx = (y >= hh ? 2 : 0) + (x >= hw ? 1 : 0);
      totals[qIdx]++;
      if (data[y * w + x] < BACKGROUND_THRESHOLD) counts[qIdx]++;
    }
  }

  return [
    counts[0] / totals[0],
    counts[1] / totals[1],
    counts[2] / totals[2],
    counts[3] / totals[3],
  ];
}

function quadrantImbalance(
  q: [number, number, number, number],
  axis: "horizontal" | "vertical"
): number {
  if (axis === "horizontal") {
    const left  = (q[0] + q[2]) / 2;
    const right = (q[1] + q[3]) / 2;
    const denom = Math.max(left, right);
    return denom > 0 ? Math.abs(left - right) / denom : 0;
  } else {
    const top    = (q[0] + q[1]) / 2;
    const bottom = (q[2] + q[3]) / 2;
    const denom  = Math.max(top, bottom);
    return denom > 0 ? Math.abs(top - bottom) / denom : 0;
  }
}

function imbalanceRegions(
  q: [number, number, number, number],
  _w: number,
  _h: number
): BoundingBox[] {
  const imgW = 1280, imgH = 720;
  const hw = imgW / 2, hh = imgH / 2;
  // Return the half with the least content (most whitespace)
  const leftDensity  = (q[0] + q[2]) / 2;
  const rightDensity = (q[1] + q[3]) / 2;
  if (leftDensity < rightDensity) {
    return [{ x: 0,  y: 0, w: Math.round(hw), h: imgH }];
  }
  return [{ x: Math.round(hw), y: 0, w: Math.round(hw), h: imgH }];
}
