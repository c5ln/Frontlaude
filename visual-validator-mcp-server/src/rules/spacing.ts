import { RuleResult } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import { toAnalysisGrayscale } from "../utils/image-processing.js";
import { config } from "../config.js";

export class SpacingRule implements BaseRule {
  readonly id = "spacing";
  readonly description =
    "Detects inconsistent vertical spacing between UI elements by analysing row-projection gaps in the layout.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const gray = await toAnalysisGrayscale(pngBuffer);
    const { data, width, height } = gray;

    const { cvError, cvWarning, minGapPx, minGaps, contentThreshold } = config.spacing;

    // Row projection: mean pixel value per row
    const rowMeans = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = 0; x < width; x++) sum += data[y * width + x];
      rowMeans[y] = sum / width;
    }

    // Mark rows as content (dark) or gap (light)
    const isContent = Array.from(rowMeans, (m) => m < contentThreshold);

    // Extract gap sizes between content bands
    const gaps = extractGapSizes(isContent, minGapPx);

    if (gaps.length < minGaps) {
      return pass(this.id, `Too few layout gaps to analyse spacing (${gaps.length} found)`);
    }

    const { mean, cv } = coefficientOfVariation(gaps);
    const details = {
      gapCount: gaps.length,
      gapMeanPx: parseFloat(mean.toFixed(1)),
      cv: parseFloat((cv * 100).toFixed(1)),
      gaps: gaps.slice(0, 10),  // first 10 for reference
    };

    if (cv > cvError) {
      return error(
        this.id,
        `Inconsistent spacing detected — gap CV: ${(cv * 100).toFixed(0)}% (mean ${mean.toFixed(0)}px, ${gaps.length} gaps)`,
        details
      );
    }
    if (cv > cvWarning) {
      return warn(
        this.id,
        `Spacing may be inconsistent — gap CV: ${(cv * 100).toFixed(0)}% (mean ${mean.toFixed(0)}px)`,
        details
      );
    }
    return pass(
      this.id,
      `Spacing is consistent (CV: ${(cv * 100).toFixed(0)}%, ${gaps.length} gaps measured)`,
      details
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractGapSizes(isContent: boolean[], minGap: number): number[] {
  const gaps: number[] = [];
  let gapStart = -1;

  for (let i = 0; i < isContent.length; i++) {
    if (!isContent[i] && gapStart === -1) {
      gapStart = i;
    } else if (isContent[i] && gapStart !== -1) {
      const size = i - gapStart;
      if (size >= minGap) gaps.push(size);
      gapStart = -1;
    }
  }
  return gaps;
}

function coefficientOfVariation(values: number[]): { mean: number; cv: number } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return { mean: 0, cv: 0 };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return { mean, cv: Math.sqrt(variance) / mean };
}
