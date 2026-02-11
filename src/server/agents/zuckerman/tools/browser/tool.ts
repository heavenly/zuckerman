import type { SecurityContext } from "@server/world/execution/security/types.js";
import { isToolAllowed } from "@server/world/execution/security/policy/tool-policy.js";
import type { Tool } from "../terminal/index.js";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  getAgentWorkspaceDir,
  getWorkspaceScreenshotsDir,
  getWorkspaceScreenshotPath,
} from "@server/world/homedir/paths.js";
import { BrowserManager } from "./browser-manager.js";
import { executeAction } from "./actions/index.js";
import { validateActionRequest } from "./utils.js";
import { takeSnapshot } from "./snapshot/snapshot.js";
import {
  getCookies,
  setCookie,
  clearCookies,
  getStorage,
  setStorage,
  clearStorage,
} from "./storage/index.js";
import {
  setOffline,
  setExtraHeaders,
  setHttpCredentials,
  setGeolocation,
  emulateMedia,
  setTimezone,
  setLocale,
  emulateDevice,
} from "./emulation/index.js";
import { setupDebugListeners, getConsoleMessages, getPageErrors, getNetworkRequests } from "./debug/index.js";
import {
  handleFileUpload,
  handleDialog,
  waitForDownload,
  downloadFile,
  getResponseBody,
  highlightElement,
} from "./files/index.js";
import type { ActionRequest, SnapshotOptions } from "./types.js";

const browserManager = new BrowserManager();

export function createBrowserTool(): Tool {
  return {
    definition: {
      name: "browser",
      description: `Control Chrome/Chromium browser. Navigate, take snapshots, interact with pages, manage tabs, cookies, storage, and more.
      
Actions:
- navigate: Navigate to URL
- snapshot: Take page snapshot (ai/aria format)
- screenshot: Take screenshot
- tabs: List/open/focus/close tabs
- act: Perform actions (click, type, press, hover, scroll, drag, select, fill, resize, wait, evaluate)
- cookies: Get/set/clear cookies
- storage: Get/set/clear localStorage/sessionStorage
- emulation: Set offline, headers, credentials, geolocation, media, timezone, locale, device
- debug: Get console messages, errors, network requests
- files: Handle uploads, dialogs, downloads
- status: Get browser status
- start/stop: Control browser lifecycle

Snapshots use ref-based element identification (e.g., "e12") for stable element references.`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description:
              "Action: navigate, snapshot, screenshot, tabs, act, cookies, storage, emulation, debug, files, status, start, stop, close",
          },
          // Navigation
          url: { type: "string", description: "URL to navigate to" },
          // Tabs
          tabAction: {
            type: "string",
            description: "Tab action: list, open, focus, close",
          },
          targetId: { type: "string", description: "Tab target ID" },
          // Actions
          request: {
            type: "object",
            description: "Action request object (for act action)",
          },
          // Snapshot
          format: { type: "string", description: "Snapshot format: ai or aria" },
          selector: { type: "string", description: "CSS selector" },
          frame: { type: "string", description: "Frame selector" },
          interactive: { type: "boolean", description: "Interactive elements only" },
          compact: { type: "boolean", description: "Compact format" },
          depth: { type: "number", description: "Max DOM depth" },
          maxChars: { type: "number", description: "Max characters per element" },
          limit: { type: "number", description: "Limit nodes (ARIA)" },
          labels: { type: "boolean", description: "Generate labels overlay" },
          refs: { type: "string", description: "Refs mode: aria or role" },
          mode: { type: "string", description: "Snapshot mode: efficient" },
          // Screenshot
          fullPage: { type: "boolean", description: "Full page screenshot" },
          ref: { type: "string", description: "Element ref for element screenshot" },
          savePath: { type: "string", description: "Save path" },
          // Cookies
          cookie: { type: "object", description: "Cookie object" },
          // Storage
          storageKind: { type: "string", description: "Storage kind: local or session" },
          key: { type: "string", description: "Storage key" },
          value: { type: "string", description: "Storage value" },
          // Emulation
          offline: { type: "boolean", description: "Offline mode" },
          headers: { type: "object", description: "HTTP headers" },
          credentials: { type: "object", description: "HTTP credentials" },
          geolocation: { type: "object", description: "Geolocation" },
          media: { type: "object", description: "Media emulation" },
          timezoneId: { type: "string", description: "Timezone ID" },
          locale: { type: "string", description: "Locale" },
          device: { type: "string", description: "Device name" },
          // Debug
          debugType: { type: "string", description: "Debug type: console, errors, requests" },
          level: { type: "string", description: "Console message level" },
          filter: { type: "string", description: "Network request filter" },
          clear: { type: "boolean", description: "Clear after get" },
          // Files
          fileAction: { type: "string", description: "File action: upload, dialog, download, wait-download, response-body, highlight" },
          paths: { type: "array", items: { type: "string" }, description: "File paths for upload" },
          accept: { type: "boolean", description: "Accept dialog" },
          promptText: { type: "string", description: "Prompt text" },
          timeoutMs: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["action"],
      },
    },
    handler: async (params, securityContext, executionContext) => {
      try {
        const { action } = params;

        if (typeof action !== "string") {
          return { success: false, error: "action must be a string" };
        }

        // Security check
        if (securityContext) {
          const toolAllowed = isToolAllowed("browser", securityContext.toolPolicy);
          if (!toolAllowed) {
            return { success: false, error: "Browser tool is not allowed by security policy" };
          }
        }

        const agentId = securityContext?.agentId || "default";

        // Handle browser lifecycle actions first
        if (action === "close") {
          await browserManager.close();
          return { success: true, result: { message: "Browser closed successfully" } };
        }

        if (action === "stop") {
          await browserManager.close();
          return { success: true, result: { message: "Browser stopped successfully" } };
        }

        if (action === "start" || action === "status") {
          const status = await browserManager.getStatus();
          return { success: true, result: status };
        }

        // Get page for other actions
        const page = await browserManager.getPage(params.targetId as string | undefined);

        // Setup debug listeners (idempotent - only sets up once per page)
        setupDebugListeners(page);

        switch (action) {
          case "navigate": {
            const url = params.url as string;
            if (!url) {
              return { success: false, error: "url is required for navigate action" };
            }
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
            const tab = await browserManager.getTab(params.targetId as string | undefined);
            return {
              success: true,
              result: { url: page.url(), title: await page.title().catch(() => "") },
            };
          }

          case "snapshot": {
            const format = (params.format as "ai" | "aria") || "ai";
            const options = {
              format,
              selector: params.selector as string | undefined,
              frame: params.frame as string | undefined,
              interactive: params.interactive as boolean | undefined,
              compact: params.compact as boolean | undefined,
              depth: params.depth as number | undefined,
              maxChars: (params.maxChars as number) || 200,
              limit: params.limit as number | undefined,
              labels: params.labels as boolean | undefined,
              refs: params.refs as "aria" | "role" | undefined,
              mode: params.mode as "efficient" | undefined,
              interactiveOnly: params.interactive === true,
            };

            const { path, result, preview } = await takeSnapshot(page, options, agentId);
            const stats = statSync(path);

            return {
              success: true,
              result: {
                format: options.format,
                path,
                url: page.url(),
                title: await page.title().catch(() => ""),
                stats: result.stats,
                refs: result.refs,
                fileSize: { bytes: stats.size, kb: (stats.size / 1024).toFixed(2) },
                preview,
                message: `Snapshot saved to: ${path}`,
              },
            };
          }

          case "screenshot": {
            const fullPage = params.fullPage === true;
            const ref = params.ref as string | undefined;
            const savePath = params.savePath as string | undefined;

            let buffer: Buffer;
            if (ref) {
              const { resolveElement } = await import("./utils.js");
              const { locator } = await resolveElement(page, ref);
              buffer = await locator.screenshot({ type: "png" });
            } else {
              buffer = await page.screenshot({ fullPage, type: "png" });
            }

            const workspaceDir = getAgentWorkspaceDir(agentId);
            const screenshotsDir = getWorkspaceScreenshotsDir(workspaceDir);
            if (!existsSync(screenshotsDir)) {
              mkdirSync(screenshotsDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const urlSlug = page.url().replace(/[^a-zA-Z0-9]/g, "-").substring(0, 50);
            const filename = `screenshot-${timestamp}-${urlSlug}.png`;
            const finalPath = savePath || getWorkspaceScreenshotPath(workspaceDir, filename);

            const dir = dirname(finalPath);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }

            writeFileSync(finalPath, buffer);

            return {
              success: true,
              result: { path: finalPath, url: page.url(), fullPage },
            };
          }

          case "tabs": {
            const tabAction = params.tabAction as string | undefined;
            const targetId = params.targetId as string | undefined;
            const url = params.url as string | undefined;

            if (!tabAction || tabAction === "list") {
              const tabs = await browserManager.listTabs();
              return {
                success: true,
                result: {
                  tabs: tabs.map((t) => ({
                    targetId: t.targetId,
                    url: t.url,
                    title: t.title,
                  })),
                },
              };
            }

            if (tabAction === "open") {
              if (!url) {
                return { success: false, error: "url is required to open tab" };
              }
              const tab = await browserManager.createTab(url);
              return {
                success: true,
                result: {
                  targetId: tab.targetId,
                  url: tab.url,
                  title: tab.title,
                },
              };
            }

            if (tabAction === "focus") {
              if (!targetId) {
                return { success: false, error: "targetId is required to focus tab" };
              }
              await browserManager.focusTab(targetId);
              return { success: true, result: { targetId } };
            }

            if (tabAction === "close") {
              if (!targetId) {
                return { success: false, error: "targetId is required to close tab" };
              }
              await browserManager.closeTab(targetId);
              return { success: true, result: { targetId } };
            }

            return { success: false, error: `Unknown tab action: ${tabAction}` };
          }

          case "act": {
            const request = params.request as ActionRequest | undefined;
            if (!request || !request.kind) {
              const suggestions: string[] = [];
              if (params.url) {
                suggestions.push("Use action='navigate' with url parameter to navigate to a page");
              }
              if (params.interactive !== undefined) {
                suggestions.push("Use action='snapshot' with interactive parameter to take a page snapshot");
              }
              const suggestionText = suggestions.length > 0 
                ? `\n\nDid you mean to:\n${suggestions.map(s => `- ${s}`).join("\n")}`
                : "";
              return { 
                success: false, 
                error: `request object with kind is required for act action. The request must be an object with a 'kind' property (e.g., 'click', 'type', 'press', 'hover', 'scrollIntoView', 'drag', 'select', 'fill', 'resize', 'wait', 'evaluate').${suggestionText}\n\nExample: { action: "act", request: { kind: "click", ref: "e12" } }` 
              };
            }

            const error = validateActionRequest(request);
            if (error) {
              return { success: false, error };
            }

            const actionResult = await executeAction(page, request);
            const tab = await browserManager.getTab(params.targetId as string | undefined);

            return {
              success: true,
              result: {
                ...(typeof actionResult === "object" && actionResult !== null ? actionResult : { value: actionResult }),
                targetId: tab.targetId,
                url: tab.url,
              },
            };
          }

          case "cookies": {
            const cookie = params.cookie as any;
            if (cookie) {
              if (cookie.clear) {
                await clearCookies(page);
              } else {
                await setCookie(page, cookie);
              }
              return { success: true, result: { ok: true } };
            }
            const cookies = await getCookies(page);
            return { success: true, result: { cookies } };
          }

          case "storage": {
            const kind = (params.storageKind as "local" | "session") || "local";
            const key = params.key as string | undefined;
            const value = params.value as string | undefined;

            if (value !== undefined) {
              if (!key) {
                return { success: false, error: "key is required to set storage" };
              }
              await setStorage(page, kind, key, value);
              return { success: true, result: { ok: true } };
            }

            if (key === "clear") {
              await clearStorage(page, kind);
              return { success: true, result: { ok: true } };
            }

            const storage = await getStorage(page, kind, key);
            return { success: true, result: { [kind]: storage } };
          }

          case "emulation": {
            if (params.offline !== undefined) {
              await setOffline(page, params.offline as boolean);
            }
            if (params.headers) {
              await setExtraHeaders(page, params.headers as Record<string, string>);
            }
            if (params.credentials) {
              await setHttpCredentials(page, params.credentials as any);
            }
            if (params.geolocation) {
              await setGeolocation(page, params.geolocation as any);
            }
            if (params.media) {
              await emulateMedia(page, params.media as any);
            }
            if (params.timezoneId) {
              await setTimezone(page, params.timezoneId as string);
            }
            if (params.locale) {
              await setLocale(page, params.locale as string);
            }
            if (params.device) {
              await emulateDevice(page, params.device as string);
            }
            return { success: true, result: { ok: true } };
          }

          case "debug": {
            const debugType = params.debugType as string | undefined;
            const level = params.level as string | undefined;
            const filter = params.filter as string | undefined;
            const clear = params.clear === true;

            if (debugType === "console" || !debugType) {
              const messages = getConsoleMessages(level);
              return { success: true, result: { messages } };
            }

            if (debugType === "errors") {
              const errors = getPageErrors(clear);
              return { success: true, result: { errors } };
            }

            if (debugType === "requests") {
              const requests = getNetworkRequests(filter, clear);
              return { success: true, result: { requests } };
            }

            return { success: false, error: `Unknown debug type: ${debugType}. Use: console, errors, requests` };
          }

          case "files": {
            const fileAction = params.fileAction as string | undefined;

            if (fileAction === "upload" || params.paths) {
              const paths = params.paths as string[];
              if (!paths || paths.length === 0) {
                return { success: false, error: "paths array required for upload" };
              }
              await handleFileUpload(
                page,
                paths,
                params.ref as string | number | undefined,
                params.selector as string | undefined,
                params.timeoutMs as number | undefined,
              );
              return { success: true, result: { ok: true } };
            }

            if (fileAction === "dialog" || params.accept !== undefined) {
              await handleDialog(
                page,
                params.accept as boolean,
                params.promptText as string | undefined,
                params.timeoutMs as number | undefined,
              );
              return { success: true, result: { ok: true } };
            }

            if (fileAction === "download") {
              if (!params.ref && !params.selector) {
                return { success: false, error: "ref or selector required for download" };
              }
              if (!params.savePath) {
                return { success: false, error: "savePath required for download" };
              }
              const result = await downloadFile(
                page,
                params.ref as string | number,
                params.selector as string,
                params.savePath as string,
                params.timeoutMs as number | undefined,
              );
              return { success: true, result };
            }

            if (fileAction === "wait-download") {
              const result = await waitForDownload(
                page,
                params.savePath as string | undefined,
                params.timeoutMs as number | undefined,
              );
              return { success: true, result };
            }

            if (fileAction === "response-body") {
              if (!params.url) {
                return { success: false, error: "url required for response-body" };
              }
              const result = await getResponseBody(
                page,
                params.url as string,
                params.timeoutMs as number | undefined,
              );
              return { success: true, result };
            }

            if (fileAction === "highlight") {
              if (!params.ref && !params.selector) {
                return { success: false, error: "ref or selector required for highlight" };
              }
              await highlightElement(
                page,
                params.ref as string | number,
                params.selector as string | undefined,
              );
              return { success: true, result: { ok: true } };
            }

            return { success: false, error: `Unknown file action: ${fileAction}. Use: upload, dialog, download, wait-download, response-body, highlight` };
          }

          default:
            return {
              success: false,
              error: `Unknown action: ${action}. Supported: navigate, snapshot, screenshot, tabs, act, cookies, storage, emulation, debug, files, status, start, stop, close`,
            };
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  };
}

import { statSync } from "node:fs";
