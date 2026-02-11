import type { Page } from "playwright-core";
import type { ActionRequest } from "./types.js";

/**
 * Resolve element locator from ref or selector
 */
export async function resolveElement(
  page: Page,
  ref?: string | number,
  selector?: string,
): Promise<{ locator: ReturnType<Page["locator"]>; method: "ref" | "selector" }> {
  if (ref !== undefined) {
    // Try to find element by ref (e.g., "e12" or 12)
    const refStr = typeof ref === "number" ? `e${ref}` : ref;
    
    // First try aria-ref attribute
    let locator = page.locator(`[aria-ref="${refStr}"]`);
    const count = await locator.count();
    if (count > 0) {
      return { locator, method: "ref" };
    }
    
    // Fallback: try data-ref or custom attribute
    locator = page.locator(`[data-ref="${refStr}"]`);
    const count2 = await locator.count();
    if (count2 > 0) {
      return { locator, method: "ref" };
    }
    
    // Last resort: try selector if provided
    if (selector) {
      return { locator: page.locator(selector), method: "selector" };
    }
    
    throw new Error(`Element with ref "${refStr}" not found`);
  }
  
  if (selector) {
    return { locator: page.locator(selector), method: "selector" };
  }
  
  throw new Error("Either ref or selector must be provided");
}

/**
 * Parse modifiers array
 */
export function parseModifiers(
  modifiers?: Array<"Control" | "Shift" | "Alt" | "Meta">,
): Array<"Control" | "Shift" | "Alt" | "Meta" | "ControlOrMeta"> {
  if (!modifiers || modifiers.length === 0) {
    return [];
  }
  return modifiers as Array<"Control" | "Shift" | "Alt" | "Meta" | "ControlOrMeta">;
}

/**
 * Parse button string to Playwright button type
 */
export function parseButton(button?: "left" | "right" | "middle"): "left" | "right" | "middle" {
  return button || "left";
}

/**
 * Wait for condition helper
 */
export async function waitForCondition(
  page: Page,
  options: {
    timeMs?: number;
    text?: string;
    textGone?: string;
    selector?: string;
    url?: string;
    loadState?: "load" | "domcontentloaded" | "networkidle";
    fn?: string;
    timeoutMs?: number;
  },
): Promise<void> {
  const timeout = options.timeoutMs || 30000;

  if (options.timeMs) {
    await page.waitForTimeout(options.timeMs);
    return;
  }

  if (options.text) {
    await page.waitForSelector(`text="${options.text}"`, { timeout });
    return;
  }

  if (options.textGone) {
    await page.waitForFunction(
      (text) => !document.body.innerText.includes(text),
      options.textGone,
      { timeout },
    );
    return;
  }

  if (options.selector) {
    await page.waitForSelector(options.selector, { timeout });
    return;
  }

  if (options.url) {
    // Support wildcards
    const pattern = options.url.replace(/\*/g, ".*");
    await page.waitForURL(new RegExp(pattern), { timeout });
    return;
  }

  if (options.loadState) {
    await page.waitForLoadState(options.loadState, { timeout });
    return;
  }

  if (options.fn) {
    await page.waitForFunction(options.fn, { timeout });
    return;
  }
}

/**
 * Validate action request
 */
export function validateActionRequest(request: ActionRequest): string | null {
  const { kind } = request;

  switch (kind) {
    case "click":
      if (!request.ref && !request.selector) {
        return "ref or selector is required for click action";
      }
      break;
    case "type":
      if (!request.ref && !request.selector) {
        return "ref or selector is required for type action";
      }
      if (!request.text) {
        return "text is required for type action";
      }
      break;
    case "press":
      if (!request.key) {
        return "key is required for press action";
      }
      break;
    case "hover":
    case "scrollIntoView":
      if (!request.ref && !request.selector) {
        return "ref or selector is required";
      }
      break;
    case "drag":
      if (!request.startRef && !request.selector) {
        return "startRef or selector is required for drag action";
      }
      if (!request.endRef) {
        return "endRef is required for drag action";
      }
      break;
    case "select":
      if (!request.ref && !request.selector) {
        return "ref or selector is required for select action";
      }
      if (!request.values || request.values.length === 0) {
        return "values array is required for select action";
      }
      break;
    case "fill":
      if (!request.fields || request.fields.length === 0) {
        return "fields array is required for fill action";
      }
      break;
    case "resize":
      if (!request.width || !request.height) {
        return "width and height are required for resize action";
      }
      break;
    case "wait":
      if (
        !request.timeMs &&
        !request.text &&
        !request.textGone &&
        !request.selector &&
        !request.url &&
        !request.loadState &&
        !request.fn
      ) {
        return "wait requires at least one condition";
      }
      break;
    case "evaluate":
      if (!request.code) {
        return "code is required for evaluate action";
      }
      break;
  }

  return null;
}
