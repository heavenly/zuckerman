import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";

export async function handlePress(page: Page, request: ActionRequest): Promise<void> {
  const { key, delayMs } = request;
  
  if (!key) {
    throw new Error("key is required for press action");
  }

  if (delayMs) {
    await page.waitForTimeout(delayMs);
  }

  await page.keyboard.press(key);
}
