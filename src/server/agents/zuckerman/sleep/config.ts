/**
 * Sleep mode configuration
 */

import type { SleepConfig } from "./types.js";

export const DEFAULT_SLEEP_THRESHOLD = 0.8; // 80%
export const DEFAULT_COOLDOWN_MINUTES = 5;
export const DEFAULT_MIN_MESSAGES_TO_SLEEP = 10;
export const DEFAULT_KEEP_RECENT_MESSAGES = 10;
export const DEFAULT_RESERVE_TOKENS_FLOOR = 10_000;
export const DEFAULT_SOFT_THRESHOLD_TOKENS = 4_000;
export const DEFAULT_CONTEXT_TOKENS = 200_000;

export const DEFAULT_SLEEP_PROMPT = [
  "Sleep mode: processing and consolidating memories.",
  "Memories are being automatically saved by the system.",
].join(" ");

export const DEFAULT_SLEEP_SYSTEM_PROMPT = [
  "Sleep mode: The system is automatically processing and consolidating memories.",
  "No action needed - memories are being saved automatically.",
].join(" ");

/**
 * Common model context window sizes
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic Claude
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  "claude-sonnet-": 1_000_000, // Extended context
  
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  
  // OpenRouter models (common ones)
  "anthropic/claude-3.5-sonnet": 200_000,
  "openai/gpt-4o": 128_000,
  "google/gemini-pro": 1_000_000,
  "meta-llama/llama-3.1-405b": 128_000,
};

/**
 * Lookup context window size for a model
 */
export function lookupContextTokens(modelId?: string, agentCfgContextTokens?: number): number {
  if (agentCfgContextTokens && agentCfgContextTokens > 0) {
    return agentCfgContextTokens;
  }
  
  if (!modelId) {
    return DEFAULT_CONTEXT_TOKENS;
  }
  
  // Check exact match first
  if (modelId in MODEL_CONTEXT_WINDOWS) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }
  
  // Check prefix matches (e.g., "claude-sonnet-4-20250514" matches "claude-sonnet-")
  for (const [prefix, tokens] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (prefix.endsWith("-") && modelId.startsWith(prefix)) {
      return tokens;
    }
  }
  
  // Default fallback
  return DEFAULT_CONTEXT_TOKENS;
}

const normalizeNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const int = Math.floor(value);
  return int >= 0 ? int : null;
};

const normalizeNonNegativeFloat = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 ? value : null;
};

/**
 * Resolve sleep settings from config
 */
export function resolveSleepConfig(cfg?: {
  sleep?: {
    enabled?: boolean;
    threshold?: number;
    cooldownMinutes?: number;
    minMessagesToSleep?: number;
    keepRecentMessages?: number;
    compressionStrategy?: SleepConfig["compressionStrategy"];
    prompt?: string;
    systemPrompt?: string;
    reserveTokensFloor?: number;
    softThresholdTokens?: number;
  };
  memoryFlush?: {
    enabled?: boolean;
    softThresholdTokens?: number;
    prompt?: string;
    systemPrompt?: string;
    reserveTokensFloor?: number;
  };
}): SleepConfig | null {
  // Check sleep config first, fallback to memoryFlush for migration
  const sleepCfg = cfg?.sleep;
  const memoryFlushCfg = cfg?.memoryFlush;
  
  // If sleep explicitly disabled, return null
  if (sleepCfg?.enabled === false) {
    return null;
  }
  
  // If memoryFlush disabled and no sleep config, return null
  if (memoryFlushCfg?.enabled === false && !sleepCfg) {
    return null;
  }
  
  const enabled = sleepCfg?.enabled ?? memoryFlushCfg?.enabled ?? true;
  if (!enabled) return null;
  
  const threshold = normalizeNonNegativeFloat(sleepCfg?.threshold ?? memoryFlushCfg?.softThresholdTokens 
    ? undefined 
    : DEFAULT_SLEEP_THRESHOLD) ?? DEFAULT_SLEEP_THRESHOLD;
  
  const cooldownMinutes = normalizeNonNegativeInt(sleepCfg?.cooldownMinutes) ?? DEFAULT_COOLDOWN_MINUTES;
  const minMessagesToSleep = normalizeNonNegativeInt(sleepCfg?.minMessagesToSleep) ?? DEFAULT_MIN_MESSAGES_TO_SLEEP;
  const keepRecentMessages = normalizeNonNegativeInt(sleepCfg?.keepRecentMessages) ?? DEFAULT_KEEP_RECENT_MESSAGES;
  const compressionStrategy = sleepCfg?.compressionStrategy ?? "hybrid";
  
  const prompt = sleepCfg?.prompt?.trim() || memoryFlushCfg?.prompt?.trim() || DEFAULT_SLEEP_PROMPT;
  const systemPrompt = sleepCfg?.systemPrompt?.trim() || memoryFlushCfg?.systemPrompt?.trim() || DEFAULT_SLEEP_SYSTEM_PROMPT;
  
  const reserveTokensFloor = normalizeNonNegativeInt(sleepCfg?.reserveTokensFloor ?? memoryFlushCfg?.reserveTokensFloor) 
    ?? DEFAULT_RESERVE_TOKENS_FLOOR;
  const softThresholdTokens = normalizeNonNegativeInt(sleepCfg?.softThresholdTokens ?? memoryFlushCfg?.softThresholdTokens) 
    ?? DEFAULT_SOFT_THRESHOLD_TOKENS;

  return {
    enabled,
    threshold,
    cooldownMinutes,
    minMessagesToSleep,
    keepRecentMessages,
    compressionStrategy,
    prompt,
    systemPrompt,
    reserveTokensFloor,
    softThresholdTokens,
  };
}
