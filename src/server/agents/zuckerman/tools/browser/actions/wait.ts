import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { waitForCondition } from "../utils.js";

export async function handleWait(page: Page, request: ActionRequest): Promise<void> {
  await waitForCondition(page, {
    timeMs: request.timeMs,
    text: request.text,
    textGone: request.textGone,
    selector: request.selector,
    url: request.url,
    loadState: request.loadState,
    fn: request.fn,
    timeoutMs: request.timeoutMs,
  });
}
