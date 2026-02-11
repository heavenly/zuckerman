import type { Page } from "playwright-core";

export interface BrowserTab {
  targetId: string;
  url: string;
  title: string;
  page: Page;
}

export interface BrowserStatus {
  running: boolean;
  tabCount: number;
  currentUrl?: string;
  currentTitle?: string;
}

export interface ClickOptions {
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Control" | "Shift" | "Alt" | "Meta">;
  timeoutMs?: number;
}

export interface TypeOptions {
  submit?: boolean;
  slowly?: boolean;
  timeoutMs?: number;
}

export interface WaitOptions {
  timeMs?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
}

export interface FormField {
  ref: string | number;
  type: string;
  value?: string | number | boolean;
}

export interface SnapshotOptions {
  format?: "ai" | "aria";
  selector?: string;
  frame?: string;
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  maxChars?: number;
  limit?: number;
  labels?: boolean;
  refs?: "aria" | "role";
  mode?: "efficient";
}

export interface Cookie {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface Geolocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface HttpCredentials {
  username?: string;
  password?: string;
  clear?: boolean;
}

export interface MediaEmulation {
  colorScheme?: "dark" | "light" | "no-preference" | null;
}

export type ActionKind =
  | "click"
  | "type"
  | "press"
  | "hover"
  | "scrollIntoView"
  | "drag"
  | "select"
  | "fill"
  | "resize"
  | "wait"
  | "evaluate"
  | "close";

export interface ActionRequest {
  kind: ActionKind;
  ref?: string | number;
  selector?: string;
  text?: string;
  key?: string;
  startRef?: string | number;
  endRef?: string | number;
  values?: string[];
  fields?: FormField[];
  width?: number;
  height?: number;
  code?: string;
  delayMs?: number;
  targetId?: string;
  // Click options
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Control" | "Shift" | "Alt" | "Meta">;
  // Type options
  submit?: boolean;
  slowly?: boolean;
  // Wait options
  timeMs?: number;
  textGone?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
}
