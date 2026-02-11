import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleType(page: Page, request: ActionRequest): Promise<void> {
  const { ref, selector, text, submit, slowly, timeoutMs } = request;
  
  if (!text) {
    throw new Error("text is required for type action");
  }

  const { locator } = await resolveElement(page, ref, selector);
  
  await locator.waitFor({ state: "visible", timeout: timeoutMs || 10000 });
  await locator.focus();

  if (slowly) {
    // Type character by character
    for (const char of text) {
      await locator.type(char, { delay: 50 });
    }
  } else {
    await locator.fill(text);
  }

  if (submit) {
    await locator.press("Enter");
  }
}
