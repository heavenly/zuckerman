/**
 * Sleep mode trigger logic
 * Determines when sleep mode should be activated
 */

import type { ConversationEntry } from "../conversations/types.js";
import type { SleepConfig } from "./types.js";
import { lookupContextTokens } from "./config.js";

/**
 * Calculate sleep threshold based on context window and config
 */
export function calculateSleepThreshold(
  contextWindowTokens: number,
  config: SleepConfig,
): number {
  const contextWindow = Math.max(1, Math.floor(contextWindowTokens));
  const thresholdRatio = Math.max(0, Math.min(1, config.threshold));
  
  // Calculate threshold: contextWindow * threshold (e.g., 200k * 0.8 = 160k)
  return Math.floor(contextWindow * thresholdRatio);
}

/**
 * Resolve context window tokens for sleep mode
 */
export function resolveSleepContextWindowTokens(params: {
  modelId?: string;
  agentCfgContextTokens?: number;
}): number {
  return lookupContextTokens(params.modelId, params.agentCfgContextTokens);
}

/**
 * Determine if sleep mode should run
 */
export function shouldSleep(params: {
  entry?: Pick<ConversationEntry, "totalTokens" | "sleepCount" | "sleepAt">;
  contextWindowTokens: number;
  config: SleepConfig;
  conversationMessageCount?: number;
}): boolean {
  const totalTokens = params.entry?.totalTokens;
  if (!totalTokens || totalTokens <= 0) return false;
  
  // Check minimum messages requirement
  if (params.conversationMessageCount !== undefined) {
    if (params.conversationMessageCount < params.config.minMessagesToSleep) {
      return false;
    }
  }
  
  // Calculate threshold
  const threshold = calculateSleepThreshold(params.contextWindowTokens, params.config);
  
  if (threshold <= 0) return false;
  if (totalTokens < threshold) return false;

  // Check cooldown - don't sleep if we just slept recently
  const lastSleepAt = params.entry?.sleepAt;
  if (lastSleepAt) {
    const cooldownMs = params.config.cooldownMinutes * 60 * 1000;
    const timeSinceLastSleep = Date.now() - lastSleepAt;
    if (timeSinceLastSleep < cooldownMs) {
      return false;
    }
  }
  
  return true;
}
