import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PlaywrightCapture } from "../capture/playwright-capture.js";
import { RuleEngine } from "../rules/engine.js";
import { CNNAnalyzer } from "../cnn/analyzer.js";
import { calculateScore } from "../utils/scoring.js";
import { formatMarkdown } from "../utils/report-formatter.js";
import { ValidateAndCaptureResult } from "../types.js";
import { DEFAULT_CNN_THRESHOLD } from "../constants.js";

export const CAPTURE_AND_VALIDATE_TOOL = {
  name: "vv_capture_and_validate",
  description:
    "Capture a screenshot of a localhost dev server URL and run the full visual validation pipeline. Returns a score (0-100), per-rule findings with bounding boxes, and the screenshot for visual inspection.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL to validate (e.g. http://localhost:3000/dashboard)",
      },
      viewport: {
        type: "object",
        description: "Browser viewport size",
        properties: {
          width: { type: "number", description: "Width in px (default: 1280)" },
          height: { type: "number", description: "Height in px (default: 720)" },
        },
        required: ["width", "height"],
      },
      full_page: {
        type: "boolean",
        description: "Capture full scrollable page (default: false)",
      },
      wait_for: {
        type: "string",
        description: "CSS selector to wait for before capturing",
      },
      rules: {
        type: "array",
        items: { type: "string" },
        description: "Rule IDs to run. Omit to run all available rules.",
      },
      use_cnn: {
        type: "boolean",
        description: "Enable CNN anomaly analysis (requires models/ui_quality.onnx). Default: true if model exists.",
      },
      threshold: {
        type: "number",
        description: "CNN anomaly threshold 0.0-1.0 (default: 0.5). Higher = less sensitive.",
      },
    },
    required: ["url"],
  },
} as const;

export async function handleCaptureAndValidate(
  args: Record<string, unknown>,
  capturer: PlaywrightCapture,
  ruleEngine: RuleEngine,
  cnnAnalyzer?: CNNAnalyzer
): Promise<CallToolResult> {
  const url = args.url as string;
  const ruleFilter = args.rules as string[] | undefined;
  const useCNN = (args.use_cnn as boolean | undefined) ?? true;
  const threshold = (args.threshold as number | undefined) ?? DEFAULT_CNN_THRESHOLD;

  // 1. Capture screenshot
  const capture = await capturer.capture({
    url,
    viewport: args.viewport as { width: number; height: number } | undefined,
    fullPage: args.full_page as boolean | undefined,
    waitFor: args.wait_for as string | undefined,
  });

  const screenshotBuffer = Buffer.from(capture.screenshot, "base64");

  // 2. Run rule engine + CNN in parallel
  const [ruleResults, cnnResults] = await Promise.all([
    ruleEngine.run(screenshotBuffer, ruleFilter),
    useCNN && cnnAnalyzer?.isReady
      ? cnnAnalyzer.analyze(screenshotBuffer, threshold).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  // 3. Aggregate score
  const validation = calculateScore(ruleResults);
  if (cnnResults) validation.cnnResults = cnnResults;

  const result: ValidateAndCaptureResult & { metadata: typeof capture.metadata } = {
    screenshot: capture.screenshot,
    timestamp: capture.metadata.timestamp,
    viewport: capture.metadata.viewport,
    validation,
    metadata: capture.metadata,
  };

  // 4. Format report
  const markdown = formatMarkdown(result);

  return {
    content: [
      {
        type: "image",
        data: capture.screenshot,
        mimeType: "image/png",
      },
      {
        type: "text",
        text: markdown,
      },
      {
        type: "text",
        text: JSON.stringify(
          { score: validation.score, pass: validation.pass, rule_results: validation.ruleResults },
          null,
          2
        ),
      },
    ],
  };
}
