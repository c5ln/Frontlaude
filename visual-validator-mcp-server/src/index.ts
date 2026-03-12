import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PlaywrightCapture } from "./capture/playwright-capture.js";
import { RuleEngine } from "./rules/engine.js";
import { CNNAnalyzer } from "./cnn/analyzer.js";
import { EmptyStateRule } from "./rules/empty-state.js";
import { AlignmentRule } from "./rules/alignment.js";
import { ColorContrastRule } from "./rules/color-contrast.js";

import {
  CAPTURE_SCREENSHOT_TOOL,
  handleCaptureScreenshot,
} from "./tools/capture-screenshot.js";
import {
  CAPTURE_AND_VALIDATE_TOOL,
  handleCaptureAndValidate,
} from "./tools/capture-and-validate.js";
import { LIST_RULES_TOOL, handleListRules } from "./tools/list-rules.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "visual-validator", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

const capturer = new PlaywrightCapture();

const ruleEngine = new RuleEngine([
  new EmptyStateRule(),
  new AlignmentRule(),
  new ColorContrastRule(),
]);

const cnnAnalyzer = new CNNAnalyzer();

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = [CAPTURE_SCREENSHOT_TOOL, CAPTURE_AND_VALIDATE_TOOL, LIST_RULES_TOOL];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// ─── Tool dispatch ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  switch (name) {
    case "vv_capture_screenshot":
      return handleCaptureScreenshot(args, capturer);

    case "vv_capture_and_validate":
      return handleCaptureAndValidate(args, capturer, ruleEngine, cnnAnalyzer);

    case "vv_list_rules":
      return handleListRules(ruleEngine);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ─── Startup / shutdown ───────────────────────────────────────────────────────

async function main() {
  await capturer.init();

  // Try to load CNN model (optional — server works without it)
  try {
    await cnnAnalyzer.load();
    process.stderr.write("visual-validator MCP server v0.3.0 started (3 rules + CNN loaded)\n");
  } catch {
    process.stderr.write("visual-validator MCP server v0.3.0 started (3 rules loaded, CNN model not found — skipping)\n");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on("SIGINT", async () => {
  await capturer.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await capturer.close();
  process.exit(0);
});

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
