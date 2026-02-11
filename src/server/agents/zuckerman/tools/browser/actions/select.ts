import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleSelect(page: Page, request: ActionRequest): Promise<void> {
  const { ref, selector, values, timeoutMs } = request;
  
  if (!values || values.length === 0) {
    throw new Error("values array is required for select action");
  }

  const { locator } = await resolveElement(page, ref, selector);
  await locator.selectOption(values, { timeout: timeoutMs || 10000 });
}
