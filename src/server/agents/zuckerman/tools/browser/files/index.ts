import type { Page } from "playwright-core";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getAgentWorkspaceDir } from "@server/world/homedir/paths.js";
import { resolveElement } from "../utils.js";

export async function handleFileUpload(
  page: Page,
  paths: string[],
  ref?: string | number,
  selector?: string,
  timeoutMs?: number,
): Promise<void> {
  // Set up file chooser handler
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: timeoutMs || 30000 }),
    ref || selector
      ? (async () => {
          const { locator } = await resolveElement(page, ref, selector);
          await locator.click();
        })()
      : Promise.resolve(),
  ]);

  await fileChooser.setFiles(paths);
}

export async function handleDialog(
  page: Page,
  accept: boolean,
  promptText?: string,
  timeoutMs?: number,
): Promise<void> {
  page.once("dialog", async (dialog) => {
    if (dialog.type() === "prompt" && promptText !== undefined) {
      await dialog.accept(promptText);
    } else if (accept) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });
}

export async function waitForDownload(
  page: Page,
  savePath?: string,
  timeoutMs?: number,
): Promise<{ path: string; suggestedFilename: string }> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs || 30000 });
  
  // If savePath not provided, use default downloads directory
  let finalPath = savePath;
  if (!finalPath) {
    const workspaceDir = getAgentWorkspaceDir("default");
    const downloadsDir = join(workspaceDir, "downloads");
    if (!existsSync(downloadsDir)) {
      mkdirSync(downloadsDir, { recursive: true });
    }
    finalPath = join(downloadsDir, `download-${Date.now()}`);
  }

  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  
  if (!finalPath.endsWith(suggestedFilename)) {
    finalPath = join(finalPath, suggestedFilename);
  }

  // Ensure directory exists
  const dir = dirname(finalPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await download.saveAs(finalPath);

  return {
    path: finalPath,
    suggestedFilename,
  };
}

export async function downloadFile(
  page: Page,
  ref: string | number | undefined,
  selector: string | undefined,
  savePath: string,
  timeoutMs?: number,
): Promise<{ path: string; suggestedFilename: string }> {
  if (!ref && !selector) {
    throw new Error("ref or selector is required for download");
  }
  const { locator } = await resolveElement(page, ref, selector);
  
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs || 30000 });
  await locator.click();
  
  const download = await downloadPromise;
  const suggestedFilename = download.suggestedFilename();
  const finalPath = savePath.endsWith(suggestedFilename) ? savePath : join(savePath, suggestedFilename);

  const dir = dirname(finalPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  await download.saveAs(finalPath);

  return {
    path: finalPath,
    suggestedFilename,
  };
}

export async function getResponseBody(
  page: Page,
  url: string,
  timeoutMs?: number,
): Promise<{ body: string; status: number; headers: Record<string, string> }> {
  const response = await page.waitForResponse(
    (resp) => resp.url().includes(url),
    { timeout: timeoutMs || 30000 },
  );

  return {
    body: await response.text(),
    status: response.status(),
    headers: response.headers(),
  };
}

export async function highlightElement(
  page: Page,
  ref: string | number,
  selector?: string,
): Promise<void> {
  const { locator } = await resolveElement(page, ref, selector);
  
  const elementHandle = await locator.elementHandle();
  if (!elementHandle) {
    throw new Error("Element not found");
  }
  
  await page.evaluate((element) => {
    const style = element.style;
    const originalOutline = style.outline;
    const originalZIndex = style.zIndex;
    
    style.outline = "3px solid red";
    style.zIndex = "999999";
    
    setTimeout(() => {
      style.outline = originalOutline;
      style.zIndex = originalZIndex;
    }, 2000);
  }, elementHandle);
}
