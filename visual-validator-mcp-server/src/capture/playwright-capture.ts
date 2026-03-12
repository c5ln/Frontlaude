import { chromium, Browser, BrowserContext, Page } from "playwright";
import { CaptureOptions, CaptureResult, Viewport } from "../types.js";
import { DEFAULT_VIEWPORT, PAGE_LOAD_TIMEOUT_MS, CAPTURE_TIMEOUT_MS } from "../constants.js";

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
    await this.init();

    const viewport: Viewport = options.viewport ?? DEFAULT_VIEWPORT;
    const context: BrowserContext = await this.browser!.newContext({ viewport });
    const page: Page = await context.newPage();

    try {
      await page.goto(options.url, {
        waitUntil: "networkidle",
        timeout: PAGE_LOAD_TIMEOUT_MS,
      });

      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, { timeout: CAPTURE_TIMEOUT_MS });
      }

      const screenshotBuffer = await this.takeScreenshot(page, options);
      const base64 = screenshotBuffer.toString("base64");

      return {
        screenshot: base64,
        metadata: {
          url: options.url,
          viewport,
          timestamp: new Date().toISOString(),
          ...(options.selector ? { selector: options.selector } : {}),
        },
      };
    } finally {
      await page.close();
      await context.close();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async takeScreenshot(page: Page, options: CaptureOptions): Promise<Buffer> {
    if (options.selector) {
      const element = await page.$(options.selector);
      if (!element) {
        throw new Error(`Selector not found: ${options.selector}`);
      }
      return element.screenshot({ type: "png" }) as Promise<Buffer>;
    }

    return page.screenshot({
      type: "png",
      fullPage: options.fullPage ?? false,
    }) as Promise<Buffer>;
  }
}
