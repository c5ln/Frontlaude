import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PlaywrightCapture } from "../capture/playwright-capture.js";

export const CAPTURE_SCREENSHOT_TOOL = {
  name: "vv_capture_screenshot",
  description:
    "Capture a screenshot of a localhost development server URL. Returns the image so Claude can visually inspect the UI without running any validation rules.",
  inputSchema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "URL to capture (e.g. http://localhost:3000/dashboard)",
      },
      viewport: {
        type: "object",
        description: "Browser viewport size",
        properties: {
          width: { type: "number", description: "Viewport width in px (default: 1280)" },
          height: { type: "number", description: "Viewport height in px (default: 720)" },
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
      selector: {
        type: "string",
        description: "CSS selector of a specific element to capture (crops to that element)",
      },
    },
    required: ["url"],
  },
} as const;

export async function handleCaptureScreenshot(
  args: Record<string, unknown>,
  capturer: PlaywrightCapture
): Promise<CallToolResult> {
  const url = args.url as string;

  const result = await capturer.capture({
    url,
    viewport: args.viewport as { width: number; height: number } | undefined,
    fullPage: args.full_page as boolean | undefined,
    waitFor: args.wait_for as string | undefined,
    selector: args.selector as string | undefined,
  });

  return {
    content: [
      {
        type: "image",
        data: result.screenshot,
        mimeType: "image/png",
      },
      {
        type: "text",
        text: JSON.stringify(result.metadata, null, 2),
      },
    ],
  };
}
