import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleEvaluate(page: Page, request: ActionRequest): Promise<unknown> {
  const { code, ref, selector } = request;
  
  if (!code) {
    throw new Error("code is required for evaluate action");
  }

  if (ref || selector) {
    // Evaluate in context of element
    const { locator } = await resolveElement(page, ref, selector);
    return await locator.evaluate(code);
  }

  // Evaluate in page context
  return await page.evaluate(code);
}
