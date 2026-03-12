import { RuleResult, BoundingBox } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisRGB, getRGBPixel } from "../utils/image-processing.js";
import { ANALYSIS_RESOLUTION } from "../constants.js";
import { config } from "../config.js";

// WCAG 2.1 contrast ratio thresholds (fixed — based on WCAG spec)
const WCAG_AA_NORMAL = 4.5;
const WCAG_AA_LARGE  = 3.0;

// Grid dimensions (fixed)
const GRID_COLS = 16;
const GRID_ROWS = 9;

export class ColorContrastRule implements BaseRule {
  readonly id = "color_contrast";
  readonly description =
    "Checks WCAG 2.1 AA contrast ratios across the UI by sampling the image in a grid, flagging regions with insufficient luminance contrast.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const rgb = await toAnalysisRGB(pngBuffer);
    const cellW = Math.floor(rgb.width / GRID_COLS);
    const cellH = Math.floor(rgb.height / GRID_ROWS);

    const failedRegions: BoundingBox[] = [];
    let analysedCells = 0;
    let failedCells = 0;
    let minContrastFound = Infinity;

    const { failRatioError, failRatioWarning, minLuminanceRange } = config.colorContrast;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const x0 = col * cellW;
        const y0 = row * cellH;
        const x1 = Math.min(x0 + cellW, rgb.width);
        const y1 = Math.min(y0 + cellH, rgb.height);

        const { minL, maxL } = this.cellLuminanceRange(rgb, x0, y0, x1, y1);

        // Skip cells without meaningful content (uniform background)
        if (maxL - minL < minLuminanceRange) continue;

        analysedCells++;
        const ratio = contrastRatio(maxL, minL);
        if (ratio < minContrastFound) minContrastFound = ratio;

        if (ratio < WCAG_AA_LARGE) {
          failedCells++;
          // Map analysis-resolution coords back to 1280x720
          failedRegions.push({
            x: Math.round((x0 / ANALYSIS_RESOLUTION.width) * 1280),
            y: Math.round((y0 / ANALYSIS_RESOLUTION.height) * 720),
            w: Math.round((cellW / ANALYSIS_RESOLUTION.width) * 1280),
            h: Math.round((cellH / ANALYSIS_RESOLUTION.height) * 720),
          });
        }
      }
    }

    if (analysedCells === 0) {
      return pass(this.id, "No content cells found for contrast analysis");
    }

    const failRatio = failedCells / analysedCells;
    const details = {
      analysedCells,
      failedCells,
      failRatio: parseFloat((failRatio * 100).toFixed(1)),
      minContrastFound:
        minContrastFound === Infinity ? null : parseFloat(minContrastFound.toFixed(2)),
      wcagAA: WCAG_AA_NORMAL,
    };

    if (failRatio > failRatioError) {
      return error(
        this.id,
        `${failedCells} of ${analysedCells} analysed cells fail WCAG AA contrast (${(failRatio * 100).toFixed(0)}%)`,
        details,
        failedRegions.slice(0, 10)
      );
    }

    if (failRatio > failRatioWarning) {
      return warn(
        this.id,
        `${failedCells} cells with low contrast detected (${(failRatio * 100).toFixed(0)}% of content cells)`,
        details,
        failedRegions.slice(0, 10)
      );
    }

    return pass(
      this.id,
      `Contrast looks acceptable (${failedCells} low-contrast cells out of ${analysedCells})`,
      details
    );
  }

  private cellLuminanceRange(
    rgb: { data: Buffer; width: number; height: number },
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): { minL: number; maxL: number } {
    let minL = 1;
    let maxL = 0;

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const [r, g, b] = getRGBPixel(rgb, x, y);
        const L = relativeLuminance(r, g, b);
        if (L < minL) minL = L;
        if (L > maxL) maxL = L;
      }
    }

    return { minL, maxL };
  }
}

// ─── WCAG helpers ─────────────────────────────────────────────────────────────

/** WCAG 2.1 relative luminance (0.0 = black, 1.0 = white) */
function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio: (L1 + 0.05) / (L2 + 0.05), L1 >= L2 */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
