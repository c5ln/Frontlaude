import { RuleResult, BoundingBox } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisGrayscale, applySobelXY } from "../utils/image-processing.js";
import { ANALYSIS_RESOLUTION } from "../constants.js";

// Strip width (px) to scan near each edge
const STRIP_PX = 6;
// Edge density thresholds (fraction of max possible edge energy in the strip)
const OVERFLOW_DENSITY_ERROR = 0.18;
const OVERFLOW_DENSITY_WARNING = 0.10;

export class OverflowRule implements BaseRule {
  readonly id = "overflow";
  readonly description =
    "Detects content clipping and overflow by measuring edge density along viewport boundaries.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const gray = await toAnalysisGrayscale(pngBuffer);
    const { mag, width, height } = applySobelXY(gray);

    const densities = {
      top:    stripDensity(mag, width, height, "top",    STRIP_PX),
      bottom: stripDensity(mag, width, height, "bottom", STRIP_PX),
      left:   stripDensity(mag, width, height, "left",   STRIP_PX),
      right:  stripDensity(mag, width, height, "right",  STRIP_PX),
    };

    const overflowEdges = (Object.entries(densities) as [string, number][])
      .filter(([, d]) => d > OVERFLOW_DENSITY_WARNING)
      .sort(([, a], [, b]) => b - a);

    const maxDensity = Math.max(...Object.values(densities));
    const details = {
      densities: Object.fromEntries(
        Object.entries(densities).map(([k, v]) => [k, parseFloat((v * 100).toFixed(1))])
      ),
    };

    if (overflowEdges.length === 0) {
      return pass(this.id, "No overflow detected at viewport boundaries", details);
    }

    const affectedEdges = overflowEdges.map(([side]) => side).join(", ");
    const regions = overflowEdges.map(([side]) => sideToRegion(side, width, height));

    if (maxDensity > OVERFLOW_DENSITY_ERROR) {
      return error(
        this.id,
        `Content overflow detected at: ${affectedEdges}`,
        details,
        regions
      );
    }
    return warn(
      this.id,
      `Possible overflow near: ${affectedEdges}`,
      details,
      regions
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripDensity(
  mag: Float32Array,
  width: number,
  height: number,
  side: string,
  stripPx: number
): number {
  let sum = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inStrip =
        (side === "top"    && y < stripPx) ||
        (side === "bottom" && y >= height - stripPx) ||
        (side === "left"   && x < stripPx) ||
        (side === "right"  && x >= width - stripPx);
      if (inStrip) {
        sum += mag[y * width + x];
        count++;
      }
    }
  }

  // Normalise: divide by (count * 255) to get [0,1]
  return count > 0 ? sum / (count * 255) : 0;
}

/** Map an edge side back to approximate original-image bounding box */
function sideToRegion(side: string, _w: number, _h: number): BoundingBox {
  const imgW = 1280, imgH = 720;
  const stripPx = Math.round(STRIP_PX / ANALYSIS_RESOLUTION.width * imgW);
  switch (side) {
    case "top":    return { x: 0,           y: 0,           w: imgW,  h: stripPx };
    case "bottom": return { x: 0,           y: imgH - stripPx, w: imgW, h: stripPx };
    case "left":   return { x: 0,           y: 0,           w: stripPx, h: imgH };
    case "right":  return { x: imgW - stripPx, y: 0,        w: stripPx, h: imgH };
    default:       return { x: 0, y: 0, w: 0, h: 0 };
  }
}
