import type { Page } from "playwright-core";
import type { Cookie } from "../types.js";

export async function getCookies(page: Page): Promise<Cookie[]> {
  const context = page.context();
  return await context.cookies();
}

export async function setCookie(page: Page, cookie: Cookie): Promise<void> {
  const context = page.context();
  await context.addCookies([cookie]);
}

export async function clearCookies(page: Page): Promise<void> {
  const context = page.context();
  await context.clearCookies();
}

export async function getStorage(
  page: Page,
  kind: "local" | "session",
  key?: string,
): Promise<Record<string, string> | string | null> {
  const result = await page.evaluate(
    ({ kind, key }) => {
      const storage = kind === "local" ? window.localStorage : window.sessionStorage;
      if (key) {
        return storage.getItem(key);
      }
      const items: Record<string, string> = {};
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k) {
          items[k] = storage.getItem(k) || "";
        }
      }
      return items;
    },
    { kind, key },
  );
  return result;
}

export async function setStorage(
  page: Page,
  kind: "local" | "session",
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ({ kind, key, value }) => {
      const storage = kind === "local" ? window.localStorage : window.sessionStorage;
      storage.setItem(key, value);
    },
    { kind, key, value },
  );
}

export async function clearStorage(page: Page, kind: "local" | "session"): Promise<void> {
  await page.evaluate(({ kind }) => {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    storage.clear();
  }, { kind });
}
