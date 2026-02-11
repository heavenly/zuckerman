import type { Page } from "playwright-core";

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface PageError {
  message: string;
  stack?: string;
  timestamp: number;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  headers: Record<string, string>;
  timestamp: number;
}

const consoleMessages: ConsoleMessage[] = [];
const pageErrors: PageError[] = [];
const networkRequests: NetworkRequest[] = [];
const listenersSetup = new WeakSet<Page>();

export function setupDebugListeners(page: Page): void {
  // Only setup once per page
  if (listenersSetup.has(page)) {
    return;
  }
  listenersSetup.add(page);

  // Console messages
  page.on("console", (msg) => {
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
    });
  });

  // Page errors
  page.on("pageerror", (error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
    });
  });

  // Network requests
  page.on("request", (request) => {
    networkRequests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      timestamp: Date.now(),
    });
  });

  page.on("response", (response) => {
    const request = networkRequests.find((r) => r.url === response.url());
    if (request) {
      request.status = response.status();
    }
  });
}

export function getConsoleMessages(level?: string): ConsoleMessage[] {
  if (level) {
    return consoleMessages.filter((m) => m.type === level);
  }
  return [...consoleMessages];
}

export function getPageErrors(clear = false): PageError[] {
  const errors = [...pageErrors];
  if (clear) {
    pageErrors.length = 0;
  }
  return errors;
}

export function getNetworkRequests(filter?: string, clear = false): NetworkRequest[] {
  let requests = [...networkRequests];
  if (filter) {
    requests = requests.filter((r) => r.url.includes(filter));
  }
  if (clear) {
    networkRequests.length = 0;
  }
  return requests;
}

export function clearAllDebugData(): void {
  consoleMessages.length = 0;
  pageErrors.length = 0;
  networkRequests.length = 0;
}
