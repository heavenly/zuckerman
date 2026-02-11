import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleDrag(page: Page, request: ActionRequest): Promise<void> {
  const { startRef, selector, endRef, timeoutMs } = request;
  
  if (!endRef) {
    throw new Error("endRef is required for drag action");
  }

  const start = await resolveElement(page, startRef, selector);
  const end = await resolveElement(page, endRef);
  
  await start.locator.dragTo(end.locator, { timeout: timeoutMs || 10000 });
}
