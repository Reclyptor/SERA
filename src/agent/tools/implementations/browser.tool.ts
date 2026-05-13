import { z } from 'zod';
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../tool.interface';

// Minimal interfaces covering only the puppeteer API surface used here.
// Puppeteer is dynamically imported at runtime; these avoid a compile-time dependency.
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

interface PuppeteerPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  screenshot(options?: Record<string, unknown>): Promise<string>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  evaluate(script: string): Promise<unknown>;
}

const MAX_CONTENT_SIZE = 100 * 1024; // 100KB

const parameters = z.object({
  action: z
    .enum(['navigate', 'screenshot', 'content', 'click', 'type', 'evaluate'])
    .describe('Browser action'),
  url: z
    .string()
    .optional()
    .describe('URL to navigate to (required for navigate)'),
  selector: z
    .string()
    .optional()
    .describe('CSS selector (for click, type, evaluate)'),
  text: z
    .string()
    .optional()
    .describe('Text to type (required for type action)'),
  javascript: z
    .string()
    .optional()
    .describe('JavaScript to evaluate (required for evaluate action)'),
});

export class BrowserTool implements Tool<typeof parameters> {
  readonly name = 'browser';
  readonly description =
    'Control a headless browser. Navigate to pages, extract content, take screenshots, and interact with elements. Requires puppeteer to be installed.';
  readonly parameters = parameters;
  readonly parallelSafe = false;

  private browser: PuppeteerBrowser | null = null;
  private page: PuppeteerPage | null = null;

  private async getBrowser(): Promise<PuppeteerBrowser> {
    if (this.browser) return this.browser;
    try {
      const puppeteer = await (Function(
        'return import("puppeteer")',
      )() as Promise<any>);
      this.browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      return this.browser!;
    } catch {
      throw new Error(
        'Browser tool requires puppeteer. Install with: npm install puppeteer',
      );
    }
  }

  private async getPage(): Promise<PuppeteerPage> {
    if (this.page) return this.page;
    const browser = await this.getBrowser();
    this.page = await browser.newPage();
    return this.page;
  }

  async execute(
    args: z.infer<typeof parameters>,
    _context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { action } = args;

    try {
      switch (action) {
        case 'navigate':
          return await this.navigate(args.url);
        case 'screenshot':
          return await this.screenshot();
        case 'content':
          return await this.getContent();
        case 'click':
          return await this.click(args.selector);
        case 'type':
          return await this.typeText(args.selector, args.text);
        case 'evaluate':
          return await this.evaluate(args.javascript);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Browser action failed',
      };
    }
  }

  private async navigate(url?: string): Promise<ToolExecutionResult> {
    if (!url) {
      return { success: false, error: 'URL is required for navigate action' };
    }

    const page = await this.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();

    return { success: true, result: { url, title } };
  }

  private async screenshot(): Promise<ToolExecutionResult> {
    if (!this.page) {
      return { success: false, error: 'No page open. Navigate first.' };
    }

    const screenshot = await this.page.screenshot({ encoding: 'base64' });
    return { success: true, result: { screenshot } };
  }

  private async getContent(): Promise<ToolExecutionResult> {
    if (!this.page) {
      return { success: false, error: 'No page open. Navigate first.' };
    }

    const raw = await this.page.content();
    const content =
      raw.length > MAX_CONTENT_SIZE
        ? raw.slice(0, MAX_CONTENT_SIZE) + '\n[...truncated]'
        : raw;

    return { success: true, result: { content, length: raw.length } };
  }

  private async click(selector?: string): Promise<ToolExecutionResult> {
    if (!selector) {
      return { success: false, error: 'Selector is required for click action' };
    }
    if (!this.page) {
      return { success: false, error: 'No page open. Navigate first.' };
    }

    await this.page.click(selector);
    return { success: true, result: { clicked: selector } };
  }

  private async typeText(
    selector?: string,
    text?: string,
  ): Promise<ToolExecutionResult> {
    if (!selector || !text) {
      return {
        success: false,
        error: 'Selector and text are required for type action',
      };
    }
    if (!this.page) {
      return { success: false, error: 'No page open. Navigate first.' };
    }

    await this.page.type(selector, text);
    return { success: true, result: { typed: text, selector } };
  }

  private async evaluate(javascript?: string): Promise<ToolExecutionResult> {
    if (!javascript) {
      return {
        success: false,
        error: 'JavaScript is required for evaluate action',
      };
    }
    if (!this.page) {
      return { success: false, error: 'No page open. Navigate first.' };
    }

    const result = await this.page.evaluate(javascript);
    return { success: true, result: { result } };
  }
}
