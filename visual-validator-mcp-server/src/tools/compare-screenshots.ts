import { createRequire } from "module";
import sharp from "sharp";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PlaywrightCapture } from "../capture/playwright-capture.js";
import { CompareResult, DiffRegion } from "../types.js";
import { DEFAULT_VIEWPORT } from "../constants.js";

// pixelmatch is CJS — use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const pixelmatch = require("pixelmatch") as (
  img1: Buffer | Uint8Array,
  img2: Buffer | Uint8Array,
  output: Buffer | Uint8Array | null,
  width: number,
  height: number,
  options?: { threshold?: number; includeAA?: boolean }
) => number;

export const COMPARE_SCREENSHOTS_TOOL = {
  name: "vv_compare_screenshots",
  description:
    "Compare two UI states (before/after) by capturing screenshots of two URLs or by diffing two base64 PNGs. Returns a diff image, changed pixel percentage, and changed region bounding boxes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url_a: {
        type: "string",
        description: "First URL to capture, OR a base64 PNG string (the 'before' state).",
      },
      url_b: {
        type: "string",
        description: "Second URL to capture, OR a base64 PNG string (the 'after' state).",
      },
      viewport: {
        type: "object",
        properties: {
          width:  { type: "number" },
          height: { type: "number" },
        },
        required: ["width", "height"],
      },
      diff_threshold: {
        type: "number",
        description: "Per-pixel colour tolerance 0.0–1.0 (default: 0.1). Higher = less sensitive.",
      },
    },
    required: ["url_a", "url_b"],
  },
} as const;

export async function handleCompareScreenshots(
  args: Record<string, unknown>,
  capturer: PlaywrightCapture
): Promise<CallToolResult> {
  const urlA = args.url_a as string;
  const urlB = args.url_b as string;
  if (!urlA) throw new Error("url_a is required.");
  if (!urlB) throw new Error("url_b is required.");

  const viewport = (args.viewport as { width: number; height: number } | undefined)
    ?? DEFAULT_VIEWPORT;
  const diffThreshold = (args.diff_threshold as number | undefined) ?? 0.1;
  if (diffThreshold < 0 || diffThreshold > 1) {
    throw new Error(`diff_threshold must be between 0.0 and 1.0, got ${diffThreshold}`);
  }

  // ── Resolve both images ───────────────────────────────────────────────────
  const [bufA, bufB] = await Promise.all([
    resolveImage(urlA, capturer, viewport),
    resolveImage(urlB, capturer, viewport),
  ]);

  // ── Normalise to same dimensions (RGBA) ───────────────────────────────────
  const { width, height } = viewport;
  const [rgbaA, rgbaB] = await Promise.all([
    toRGBA(bufA, width, height),
    toRGBA(bufB, width, height),
  ]);

  // ── pixelmatch diff ───────────────────────────────────────────────────────
  const diffRaw = Buffer.alloc(width * height * 4);
  const numDiffPixels = pixelmatch(rgbaA, rgbaB, diffRaw, width, height, {
    threshold: diffThreshold,
    includeAA: false,
  });

  const diffPercentage = parseFloat(((numDiffPixels / (width * height)) * 100).toFixed(2));

  // ── Encode diff PNG ───────────────────────────────────────────────────────
  const diffPNG = await sharp(diffRaw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

  // ── Extract changed regions ───────────────────────────────────────────────
  const changedRegions = extractChangedRegions(diffRaw, width, height);

  const result: CompareResult = {
    screenshots: {
      a: bufA.toString("base64"),
      b: bufB.toString("base64"),
    },
    diffImage: diffPNG.toString("base64"),
    diffPercentage,
    changedRegions,
  };

  const summary = buildSummary(diffPercentage, changedRegions);

  return {
    content: [
      { type: "image", data: result.screenshots.a, mimeType: "image/png" },
      { type: "image", data: result.screenshots.b, mimeType: "image/png" },
      { type: "image", data: result.diffImage,     mimeType: "image/png" },
      { type: "text",  text: summary },
      { type: "text",  text: JSON.stringify(
          { diffPercentage, changedRegions: result.changedRegions },
          null, 2
        )
      },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveImage(
  input: string,
  capturer: PlaywrightCapture,
  viewport: { width: number; height: number }
): Promise<Buffer> {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const capture = await capturer.capture({ url: input, viewport });
    return Buffer.from(capture.screenshot, "base64");
  }
  // Treat as base64 PNG
  return Buffer.from(input, "base64");
}

async function toRGBA(pngBuffer: Buffer, width: number, height: number): Promise<Buffer> {
  const { data } = await sharp(pngBuffer)
    .resize(width, height, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

/**
 * Find changed regions in the diff image using a coarse grid.
 * Each grid cell is 40×40px; cells with >5% changed pixels are marked.
 */
function extractChangedRegions(diffRaw: Buffer, width: number, height: number): DiffRegion[] {
  const CELL = 40;
  const cols = Math.ceil(width  / CELL);
  const rows = Math.ceil(height / CELL);

  const cellChanged: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false)
  );
  const cellDiffScore: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0)
  );

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // pixelmatch outputs magenta (255, 0, 255) for changed pixels
      const isMagenta = diffRaw[idx] > 200 && diffRaw[idx + 1] < 50 && diffRaw[idx + 2] > 200;
      if (isMagenta) {
        const col = Math.floor(x / CELL);
        const row = Math.floor(y / CELL);
        cellDiffScore[row][col]++;
      }
    }
  }

  const cellArea = CELL * CELL;
  const regions: DiffRegion[] = [];

  // Simple run-length merge: consecutive changed cells in same row → single region
  for (let r = 0; r < rows; r++) {
    let runStart = -1;
    let maxScore = 0;

    for (let c = 0; c <= cols; c++) {
      const score = c < cols ? cellDiffScore[r][c] / cellArea : 0;
      const active = score > 0.03;

      if (active && runStart === -1) {
        runStart = c;
        maxScore = score;
      } else if (active) {
        maxScore = Math.max(maxScore, score);
      } else if (!active && runStart !== -1) {
        regions.push({
          x: runStart * CELL,
          y: r * CELL,
          w: (c - runStart) * CELL,
          h: CELL,
          diffScore: parseFloat((maxScore * 100).toFixed(1)),
        });
        runStart = -1;
        maxScore = 0;
      }
    }
  }

  return regions
    .sort((a, b) => b.diffScore - a.diffScore)
    .slice(0, 20);
}

function buildSummary(diffPercentage: number, regions: DiffRegion[]): string {
  const level =
    diffPercentage < 0.5  ? "거의 변화 없음" :
    diffPercentage < 5    ? "소폭 변경" :
    diffPercentage < 20   ? "상당한 변경" :
                            "대폭 변경";

  return [
    `## Screenshot Comparison`,
    ``,
    `| | |`,
    `|---|---|`,
    `| 변경된 픽셀 비율 | **${diffPercentage}%** |`,
    `| 변경 수준 | ${level} |`,
    `| 변경 영역 | ${regions.length}개 감지 |`,
    ``,
    regions.length > 0
      ? `### 주요 변경 영역\n${regions.slice(0, 5).map((r, i) =>
          `${i + 1}. (${r.x}, ${r.y}) ${r.w}×${r.h}px — 변경도 ${r.diffScore}%`
        ).join("\n")}`
      : "_변경된 영역 없음_",
  ].join("\n");
}
