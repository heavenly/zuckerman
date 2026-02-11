import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";

export async function handleResize(page: Page, request: ActionRequest): Promise<void> {
  const { width, height } = request;
  
  if (!width || !height) {
    throw new Error("width and height are required for resize action");
  }

  await page.setViewportSize({ width, height });
}
