import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleHover(page: Page, request: ActionRequest): Promise<void> {
  const { ref, selector, timeoutMs } = request;
  
  const { locator } = await resolveElement(page, ref, selector);
  await locator.hover({ timeout: timeoutMs || 10000 });
}
