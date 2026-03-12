import { RuleResult, BoundingBox } from "../types.js";
import { BaseRule, pass, warn, error } from "./base-rule.js";
import {
  toAnalysisGrayscale,
  applySobelXY,
  findPeaks,
} from "../utils/image-processing.js";
import { ANALYSIS_RESOLUTION } from "../constants.js";
import { config } from "../config.js";

export class AlignmentRule implements BaseRule {
  readonly id = "alignment";
  readonly description =
    "Detects vertical misalignment by analysing vertical-edge distribution across the layout using Sobel + column projection.";

  async run(pngBuffer: Buffer): Promise<RuleResult> {
    const gray = await toAnalysisGrayscale(pngBuffer);
    const { gx, width, height } = applySobelXY(gray);

    // Column projection: sum of vertical-edge strength (|Gx|) per x-column
    const colProj = new Float32Array(width);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        colProj[x] += gx[y * width + x];
      }
    }

    const totalEnergy = colProj.reduce((a, b) => a + b, 0);
    if (totalEnergy < 500) {
      // Near-empty image → empty_state rule handles this
      return pass(this.id, "Insufficient edge data for alignment analysis");
    }

    const maxCol = Math.max(...colProj);
    const { errorRatio, warningRatio, peakTolerance, minPeakDistance } = config.alignment;
    const peakMinValue = maxCol * 0.15; // peaks must be at least 15% of strongest column

    const peaks = findPeaks(colProj, peakMinValue, minPeakDistance);

    // Sum energy near peaks vs total
    let alignedEnergy = 0;
    const peakSet = new Set<number>();
    for (const p of peaks) {
      for (let dx = -peakTolerance; dx <= peakTolerance; dx++) {
        const x = p + dx;
        if (x >= 0 && x < width) peakSet.add(x);
      }
    }
    for (const x of peakSet) {
      alignedEnergy += colProj[x];
    }

    const alignmentRatio = alignedEnergy / totalEnergy;

    // Find "outlier" columns: strong edge energy far from any peak
    const offAxisRegions = this.findOffAxisRegions(colProj, peakSet, width, height, maxCol);

    const details = {
      alignmentRatio: parseFloat((alignmentRatio * 100).toFixed(1)),
      dominantAxes: peaks.length,
      peaks: peaks.map((p) => Math.round((p / width) * 100)), // as % of width
    };

    if (alignmentRatio < errorRatio) {
      return error(
        this.id,
        `Elements appear misaligned — only ${(alignmentRatio * 100).toFixed(0)}% of vertical edges align to dominant axes`,
        details,
        offAxisRegions
      );
    }

    if (alignmentRatio < warningRatio) {
      return warn(
        this.id,
        `Some elements may be misaligned (alignment ratio: ${(alignmentRatio * 100).toFixed(0)}%)`,
        details,
        offAxisRegions
      );
    }

    return pass(
      this.id,
      `Alignment looks good (${(alignmentRatio * 100).toFixed(0)}% of edges at ${peaks.length} dominant axes)`,
      details
    );
  }

  /** Collect horizontal regions of off-axis vertical edge energy (for bounding boxes) */
  private findOffAxisRegions(
    colProj: Float32Array,
    peakSet: Set<number>,
    width: number,
    height: number,
    maxCol: number
  ): BoundingBox[] {
    const threshold = maxCol * 0.10;
    const regions: BoundingBox[] = [];
    let runStart = -1;

    for (let x = 0; x < width; x++) {
      const isOffAxis = !peakSet.has(x) && colProj[x] > threshold;
      if (isOffAxis && runStart === -1) {
        runStart = x;
      } else if (!isOffAxis && runStart !== -1) {
        // Convert analysis-resolution coords back to approximate original-image coords
        const scaleX = 1 / ANALYSIS_RESOLUTION.width;
        const scaleY = 1 / ANALYSIS_RESOLUTION.height;
        regions.push({
          x: Math.round(runStart / ANALYSIS_RESOLUTION.width * 1280),
          y: 0,
          w: Math.round((x - runStart) / ANALYSIS_RESOLUTION.width * 1280),
          h: Math.round(height * scaleY * 720),
        });
        runStart = -1;
        if (regions.length >= 5) break; // cap at 5 regions
      }
    }

    return regions;
  }
}
