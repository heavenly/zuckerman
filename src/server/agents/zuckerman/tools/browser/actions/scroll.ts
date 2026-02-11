import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleScrollIntoView(page: Page, request: ActionRequest): Promise<void> {
  const { ref, selector, timeoutMs } = request;
  
  const { locator } = await resolveElement(page, ref, selector);
  await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs || 10000 });
}
