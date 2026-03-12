import { chromium, Browser, BrowserContext, Page } from "playwright";
import { CaptureOptions, CaptureResult, Viewport } from "../types.js";
import { DEFAULT_VIEWPORT } from "../constants.js";
import { config } from "../config.js";

export class PlaywrightCapture {
  private browser: Browser | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async capture(options: CaptureOptions): Promise<CaptureResult> {
    validateUrl(options.url);
    await this.init();

    const viewport: Viewport = options.viewport ?? DEFAULT_VIEWPORT;
    const context: BrowserContext = await this.browser!.newContext({ viewport });
    const page: Page = await context.newPage();

    try {
      await this.navigateTo(page, options.url);

      if (options.waitFor) {
        await page
          .waitForSelector(options.waitFor, { timeout: config.captureTimeoutMs })
          .catch(() => {
            throw new Error(
              `Selector "${options.waitFor}" not found within ${config.captureTimeoutMs}ms. ` +
              `Check if the element exists and the page has fully loaded.`
            );
          });
      }

      const screenshotBuffer = await this.takeScreenshot(page, options);

      return {
        screenshot: screenshotBuffer.toString("base64"),
        metadata: {
          url: options.url,
          viewport,
          timestamp: new Date().toISOString(),
          ...(options.selector ? { selector: options.selector } : {}),
        },
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async navigateTo(page: Page, url: string): Promise<void> {
    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: config.pageLoadTimeoutMs,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("ERR_CONNECTION_REFUSED")) {
        throw new Error(
          `Connection refused: ${url}\n` +
          `Is the development server running? Try: npm run dev`
        );
      }
      if (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ERR_NAME_NOT_RESOLVED")) {
        throw new Error(`Cannot resolve host: ${url}\nCheck the URL and your network connection.`);
      }
      if (msg.includes("Timeout") || msg.includes("timeout")) {
        throw new Error(
          `Page load timed out after ${config.pageLoadTimeoutMs}ms: ${url}\n` +
          `Try increasing VV_PAGE_LOAD_TIMEOUT_MS or use wait_for to wait for a specific element.`
        );
      }
      throw new Error(`Failed to load ${url}: ${msg}`);
    }
  }

  private async takeScreenshot(page: Page, options: CaptureOptions): Promise<Buffer> {
    if (options.selector) {
      const element = await page.$(options.selector);
      if (!element) {
        throw new Error(
          `Element not found: "${options.selector}"\n` +
          `Verify the CSS selector is correct and the element is visible.`
        );
      }
      return element.screenshot({ type: "png" }) as Promise<Buffer>;
    }

    return page.screenshot({
      type: "png",
      fullPage: options.fullPage ?? false,
    }) as Promise<Buffer>;
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateUrl(url: string): void {
  if (!url || typeof url !== "string") {
    throw new Error("url is required and must be a string.");
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error(
      `Invalid URL: "${url}"\nURL must start with http:// or https://`
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`Malformed URL: "${url}"`);
  }
}
