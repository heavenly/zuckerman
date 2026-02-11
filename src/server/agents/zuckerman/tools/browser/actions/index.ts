import type { Page } from "playwright-core";
import type { ActionRequest } from "../types.js";
import { handleClick } from "./click.js";
import { handleType } from "./type.js";
import { handlePress } from "./press.js";
import { handleHover } from "./hover.js";
import { handleScrollIntoView } from "./scroll.js";
import { handleDrag } from "./drag.js";
import { handleSelect } from "./select.js";
import { handleFill } from "./fill.js";
import { handleResize } from "./resize.js";
import { handleWait } from "./wait.js";
import { handleEvaluate } from "./evaluate.js";

export async function executeAction(page: Page, request: ActionRequest): Promise<unknown> {
  switch (request.kind) {
    case "click":
      await handleClick(page, request);
      return { ok: true };
    case "type":
      await handleType(page, request);
      return { ok: true };
    case "press":
      await handlePress(page, request);
      return { ok: true };
    case "hover":
      await handleHover(page, request);
      return { ok: true };
    case "scrollIntoView":
      await handleScrollIntoView(page, request);
      return { ok: true };
    case "drag":
      await handleDrag(page, request);
      return { ok: true };
    case "select":
      await handleSelect(page, request);
      return { ok: true };
    case "fill":
      await handleFill(page, request);
      return { ok: true };
    case "resize":
      await handleResize(page, request);
      return { ok: true };
    case "wait":
      await handleWait(page, request);
      return { ok: true };
    case "evaluate":
      return await handleEvaluate(page, request);
    default:
      throw new Error(`Unknown action kind: ${(request as ActionRequest).kind}`);
  }
}
