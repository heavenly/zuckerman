import type { Page } from "playwright-core";
import type { Geolocation, HttpCredentials, MediaEmulation } from "./types.js";

export async function setOffline(page: Page, offline: boolean): Promise<void> {
  const context = page.context();
  await context.setOffline(offline);
}

export async function setExtraHeaders(page: Page, headers: Record<string, string>): Promise<void> {
  const context = page.context();
  await context.setExtraHTTPHeaders(headers);
}

export async function setHttpCredentials(
  page: Page,
  credentials: HttpCredentials,
): Promise<void> {
  const context = page.context();
  if (credentials.clear) {
    await context.setHTTPCredentials(null);
  } else if (credentials.username && credentials.password) {
    await context.setHTTPCredentials({
      username: credentials.username,
      password: credentials.password,
    });
  }
}

export async function setGeolocation(page: Page, geolocation: Geolocation): Promise<void> {
  const context = page.context();
  await context.setGeolocation({
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
    accuracy: geolocation.accuracy,
  });
}

export async function emulateMedia(page: Page, media: MediaEmulation): Promise<void> {
  if (media.colorScheme !== undefined) {
    await page.emulateMedia({ colorScheme: media.colorScheme || undefined });
  }
}

export async function setTimezone(page: Page, timezoneId: string): Promise<void> {
  const context = page.context();
  await context.addInitScript(`Intl.DateTimeFormat = class extends Intl.DateTimeFormat {
    constructor(...args) {
      super(...args);
      this.resolvedOptions = () => ({
        ...super.resolvedOptions(),
        timeZone: "${timezoneId}",
      });
    }
  }`);
}

export async function setLocale(page: Page, locale: string): Promise<void> {
  const context = page.context();
  await context.addInitScript(`Object.defineProperty(navigator, 'language', {
    get: () => "${locale}"
  });`);
}

export async function emulateDevice(page: Page, deviceName: string): Promise<void> {
  // Common device presets
  const devices: Record<string, { width: number; height: number; deviceScaleFactor: number }> = {
    "iPhone 14": { width: 390, height: 844, deviceScaleFactor: 3 },
    "iPhone 14 Pro": { width: 393, height: 852, deviceScaleFactor: 3 },
    "Pixel 5": { width: 393, height: 851, deviceScaleFactor: 3 },
    "iPad": { width: 810, height: 1080, deviceScaleFactor: 2 },
  };

  const device = devices[deviceName];
  if (device) {
    await page.setViewportSize({
      width: device.width,
      height: device.height,
    });
    await page.evaluate((scale) => {
      Object.defineProperty(window, "devicePixelRatio", {
        get: () => scale,
      });
    }, device.deviceScaleFactor);
  } else {
    throw new Error(`Unknown device: ${deviceName}. Supported: ${Object.keys(devices).join(", ")}`);
  }
}
