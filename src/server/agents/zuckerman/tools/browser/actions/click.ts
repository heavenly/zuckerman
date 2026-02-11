import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { resolveElement, parseButton, parseModifiers } from "../utils.js";

export async function handleClick(page: Page, request: ActionRequest): Promise<void> {
  const { ref, selector, doubleClick, button, modifiers, timeoutMs } = request;
  
  const { locator } = await resolveElement(page, ref, selector);
  const buttonType = parseButton(button);
  const mods = parseModifiers(modifiers);
  
  const options: Parameters<typeof locator.click>[0] = {
    button: buttonType,
    modifiers: mods,
    timeout: timeoutMs || 10000,
  };

  if (doubleClick) {
    await locator.dblclick(options);
  } else {
    await locator.click(options);
  }
}
