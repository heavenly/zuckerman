import type { Page } from "playwright-core";
import type { ActionRequest, FormField } from "../types.js";
import { resolveElement } from "../utils.js";

export async function handleFill(page: Page, request: ActionRequest): Promise<void> {
  const { fields, timeoutMs } = request;
  
  if (!fields || fields.length === 0) {
    throw new Error("fields array is required for fill action");
  }

  for (const field of fields) {
    const { ref, type, value } = field;
    const { locator } = await resolveElement(page, typeof ref === "number" ? `e${ref}` : ref);
    
    await locator.waitFor({ state: "visible", timeout: timeoutMs || 10000 });

    switch (type) {
      case "text":
      case "email":
      case "password":
      case "search":
      case "tel":
      case "url":
        await locator.fill(String(value || ""));
        break;
      case "checkbox":
      case "radio":
        if (value === true || value === "true") {
          await locator.check();
        } else {
          await locator.uncheck();
        }
        break;
      case "select":
        if (value !== undefined) {
          await locator.selectOption(String(value));
        }
        break;
      default:
        await locator.fill(String(value || ""));
    }
  }
}
