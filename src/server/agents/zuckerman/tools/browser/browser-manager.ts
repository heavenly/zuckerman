import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getBrowserDataDir } from "@server/world/homedir/paths.js";
import type { BrowserTab, BrowserStatus } from "./types.js";

const BROWSER_DATA_DIR = getBrowserDataDir();
const execAsync = promisify(exec);

/**
 * Manages browser lifecycle and tab instances
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tabs: Map<string, BrowserTab> = new Map();
  private currentTabId: string | null = null;
  private tabCounter = 0;

  async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      // Ensure browser data directory exists
      if (!existsSync(BROWSER_DATA_DIR)) {
        mkdirSync(BROWSER_DATA_DIR, { recursive: true });
      }

      this.browser = await chromium.launch({
        headless: false,
        channel: "chrome",
        timeout: 30000,
        args: [
          "--start-maximized",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      this.context = await this.browser.newContext({
        viewport: null,
      });

      // Bring browser to front (macOS)
      if (process.platform === "darwin") {
        try {
          await execAsync(
            `osascript -e 'tell application "System Events" to set frontmost of every process whose name contains "Chrome" to true'`,
          );
        } catch {
          // Ignore if it fails
        }
      }
    }
    return this.browser;
  }

  async getContext(): Promise<BrowserContext> {
    await this.getBrowser();
    if (!this.context || !this.context.browser()?.isConnected()) {
      await this.getBrowser();
      this.context = await this.browser!.newContext({
        viewport: null,
      });
    }
    return this.context;
  }

  async createTab(url?: string): Promise<BrowserTab> {
    const context = await this.getContext();
    const page = await context.newPage();
    
    const targetId = `tab-${++this.tabCounter}`;
    const tab: BrowserTab = {
      targetId,
      url: url || page.url(),
      title: await page.title().catch(() => ""),
      page,
    };

    if (url && url !== "about:blank") {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      tab.url = page.url();
      tab.title = await page.title().catch(() => "");
    }

    this.tabs.set(targetId, tab);
    this.currentTabId = targetId;
    return tab;
  }

  async getTab(targetId?: string): Promise<BrowserTab> {
    if (targetId) {
      const tab = this.tabs.get(targetId);
      if (tab && !tab.page.isClosed()) {
        return tab;
      }
      this.tabs.delete(targetId);
      throw new Error(`Tab ${targetId} not found or closed`);
    }

    if (this.currentTabId) {
      const tab = this.tabs.get(this.currentTabId);
      if (tab && !tab.page.isClosed()) {
        return tab;
      }
      this.currentTabId = null;
    }

    // Create new tab if none exists
    return await this.createTab();
  }

  async getPage(targetId?: string): Promise<Page> {
    const tab = await this.getTab(targetId);
    return tab.page;
  }

  async listTabs(): Promise<BrowserTab[]> {
    // Update tab info and remove closed tabs
    const activeTabs: BrowserTab[] = [];
    for (const [id, tab] of this.tabs.entries()) {
      if (tab.page.isClosed()) {
        this.tabs.delete(id);
        if (this.currentTabId === id) {
          this.currentTabId = null;
        }
      } else {
        try {
          tab.url = tab.page.url();
          tab.title = await tab.page.title().catch(() => "");
          activeTabs.push(tab);
        } catch {
          this.tabs.delete(id);
          if (this.currentTabId === id) {
            this.currentTabId = null;
          }
        }
      }
    }
    return activeTabs;
  }

  async closeTab(targetId: string): Promise<void> {
    const tab = this.tabs.get(targetId);
    if (tab) {
      if (!tab.page.isClosed()) {
        await tab.page.close().catch(() => {});
      }
      this.tabs.delete(targetId);
      if (this.currentTabId === targetId) {
        this.currentTabId = null;
        // Set another tab as current if available
        const remaining = Array.from(this.tabs.values())[0];
        if (remaining) {
          this.currentTabId = remaining.targetId;
        }
      }
    }
  }

  async focusTab(targetId: string): Promise<void> {
    const tab = this.tabs.get(targetId);
    if (!tab) {
      throw new Error(`Tab ${targetId} not found`);
    }
    if (tab.page.isClosed()) {
      throw new Error(`Tab ${targetId} is closed`);
    }
    this.currentTabId = targetId;
    await tab.page.bringToFront();
  }

  async getStatus(): Promise<BrowserStatus> {
    const tabs = await this.listTabs();
    const currentTab = this.currentTabId ? tabs.find((t) => t.targetId === this.currentTabId) : tabs[0];

    return {
      running: this.browser !== null && this.browser.isConnected(),
      tabCount: tabs.length,
      currentUrl: currentTab?.url,
      currentTitle: currentTab?.title,
    };
  }

  async close(): Promise<void> {
    // Close all tabs
    for (const tab of this.tabs.values()) {
      if (!tab.page.isClosed()) {
        await tab.page.close().catch(() => {});
      }
    }
    this.tabs.clear();
    this.currentTabId = null;

    // Close context
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }

    // Close browser
    if (this.browser && this.browser.isConnected()) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isOpen(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}
