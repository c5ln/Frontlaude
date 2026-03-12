import { RuleResult } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisGrayscale, computeVariance } from "../utils/image-processing.js";
import { config } from "../config.js";

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

    const { stdDevError, stdDevWarning, whiteRatioError, whiteRatioWarning } = config.emptyState;
    if (stdDev < stdDevError || whiteRatio > whiteRatioError) {
      return error(
        this.id,
        `Screen appears empty or blank (std-dev: ${stdDev.toFixed(1)}, white: ${(whiteRatio * 100).toFixed(0)}%)`,
        details
      );
    }

    if (stdDev < stdDevWarning || whiteRatio > whiteRatioWarning) {
      return warn(
        this.id,
        `Very low content detected — possible loading state (std-dev: ${stdDev.toFixed(1)}, white: ${(whiteRatio * 100).toFixed(0)}%)`,
        details
      );
    }

    return pass(this.id, `Content detected (std-dev: ${stdDev.toFixed(1)})`, details);
  }
}
