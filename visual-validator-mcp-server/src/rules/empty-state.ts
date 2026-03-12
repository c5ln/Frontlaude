import { RuleResult } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisGrayscale, computeVariance } from "../utils/image-processing.js";

// Thresholds (pixel std-dev on 0-255 scale)
const EMPTY_STDDEV_ERROR = 10;    // nearly uniform — blank page or solid color
const EMPTY_STDDEV_WARNING = 20;  // very low content, possibly loading state

// What fraction of pixels can be near-white (> 240) before flagging
const BLANK_WHITE_RATIO_ERROR = 0.97;
const BLANK_WHITE_RATIO_WARNING = 0.90;

export class EmptyStateRule implements BaseRule {
  readonly id = "empty_state";
  readonly description =
    "Detects blank pages, loading failures, or screens with no meaningful content via pixel entropy analysis.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const gray = await toAnalysisGrayscale(pngBuffer);
    const { stdDev } = computeVariance(gray.data);

    // Count near-white pixels
    let whiteCount = 0;
    for (let i = 0; i < gray.data.length; i++) {
      if (gray.data[i] > 240) whiteCount++;
    }
    const whiteRatio = whiteCount / gray.data.length;

    const details = {
      stdDev: parseFloat(stdDev.toFixed(2)),
      whiteRatio: parseFloat((whiteRatio * 100).toFixed(1)),
    };

    if (stdDev < EMPTY_STDDEV_ERROR || whiteRatio > BLANK_WHITE_RATIO_ERROR) {
      return error(
        this.id,
        `Screen appears empty or blank (std-dev: ${stdDev.toFixed(1)}, white: ${(whiteRatio * 100).toFixed(0)}%)`,
        details
      );
    }

    if (stdDev < EMPTY_STDDEV_WARNING || whiteRatio > BLANK_WHITE_RATIO_WARNING) {
      return warn(
        this.id,
        `Very low content detected — possible loading state (std-dev: ${stdDev.toFixed(1)}, white: ${(whiteRatio * 100).toFixed(0)}%)`,
        details
      );
    }

    return pass(this.id, `Content detected (std-dev: ${stdDev.toFixed(1)})`, details);
  }
}
