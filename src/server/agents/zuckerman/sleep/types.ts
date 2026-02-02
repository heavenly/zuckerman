/**
 * Sleep mode types and interfaces
 */

export type CompressionStrategy = 
  | "sliding-window"      // Keep recent N messages, summarize rest
  | "progressive-summary" // Progressively summarize older messages
  | "importance-based"   // Keep important messages, compress less important
  | "semantic-chunks"     // Group related messages and summarize
  | "hybrid";             // Combine multiple strategies

export interface SleepConfig {
  enabled: boolean;
  threshold: number;              // Default: 0.8 (80%)
  cooldownMinutes: number;         // Default: 5 minutes
  minMessagesToSleep: number;      // Default: 10 messages
  keepRecentMessages: number;      // Default: 10
  compressionStrategy: CompressionStrategy;
  prompt: string;                  // Sleep mode prompt
  systemPrompt: string;            // Sleep mode system prompt
  reserveTokensFloor: number;     // Reserve tokens
  softThresholdTokens: number;     // Soft threshold buffer
}

export interface ContextMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  tokens: number;
  importance?: number;
  compressed?: boolean;
  summary?: string;
  originalLength?: number;
}

export interface ConsolidatedMemory {
  content: string;
  type: "fact" | "preference" | "decision" | "event" | "learning";
  importance: number; // 0-1
  shouldSaveToLongTerm: boolean;
}
