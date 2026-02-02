/**
 * Sleep mode summarization and context compression
 * Moves compression logic from context-manager.ts
 */

import type { ContextMessage, CompressionStrategy } from "./types.js";

/**
 * Estimate token count (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate message importance score
 */
export function calculateImportance(message: ContextMessage, index: number, total: number): number {
  let score = 0.5; // Base score

  // Recency boost (more recent = more important)
  const recencyRatio = 1 - (index / total);
  score += recencyRatio * 0.3;

  // Length factor (very short or very long might be less important)
  const lengthRatio = Math.min(message.tokens / 500, 1);
  score += (1 - Math.abs(lengthRatio - 0.5)) * 0.1;

  // Role importance
  if (message.role === "user") score += 0.1;
  if (message.role === "system") score += 0.2;

  // Tool calls are important
  if (message.role === "tool") score += 0.15;

  return Math.min(score, 1.0);
}

/**
 * Extract key points from text (simple heuristic)
 */
export function extractKeyPoints(text: string, maxLength: number): string {
  // Remove extra whitespace
  const cleaned = text.trim().replace(/\s+/g, " ");
  
  // If short enough, return as-is
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Try to find sentence boundaries
  const sentences = cleaned.split(/[.!?]\s+/);
  if (sentences.length > 1) {
    // Take first sentence if it's reasonable
    if (sentences[0].length <= maxLength) {
      return sentences[0] + "...";
    }
  }

  // Fallback: truncate with ellipsis
  return cleaned.substring(0, maxLength - 3) + "...";
}

/**
 * Summarize a group of messages
 */
export function summarizeMessages(messages: ContextMessage[], maxTokens: number): string | null {
  if (messages.length === 0) return null;

  // Simple summarization: extract key points
  const keyPoints: string[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    if (msg.role === "user") {
      const summary = extractKeyPoints(msg.content, 50);
      if (currentTokens + estimateTokens(summary) <= maxTokens) {
        keyPoints.push(`User: ${summary}`);
        currentTokens += estimateTokens(summary);
      }
    } else if (msg.role === "assistant") {
      const summary = extractKeyPoints(msg.content, 50);
      if (currentTokens + estimateTokens(summary) <= maxTokens) {
        keyPoints.push(`Assistant: ${summary}`);
        currentTokens += estimateTokens(summary);
      }
    }
  }

  if (keyPoints.length === 0) return null;

  return `[Compressed context from ${messages.length} earlier messages]\n\n${keyPoints.join("\n")}`;
}

/**
 * Compress messages using sliding window strategy
 */
export function compressSlidingWindow(
  messages: ContextMessage[],
  targetTokens: number,
  keepRecent: number,
): ContextMessage[] {
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  if (oldMessages.length === 0) {
    return recentMessages;
  }

  // Calculate tokens in recent messages
  const recentTokens = recentMessages.reduce((sum, msg) => sum + msg.tokens, 0);
  const remainingBudget = targetTokens - recentTokens;

  if (remainingBudget <= 0) {
    // Even recent messages exceed budget - keep only most recent
    return compressToFit(recentMessages, targetTokens);
  }

  // Summarize old messages to fit remaining budget
  const summary = summarizeMessages(oldMessages, remainingBudget);
  
  if (summary) {
    return [
      {
        role: "system",
        content: summary,
        timestamp: oldMessages[0]?.timestamp || Date.now(),
        tokens: estimateTokens(summary),
        compressed: true,
        summary: summary,
        originalLength: oldMessages.length,
      },
      ...recentMessages,
    ];
  }

  return recentMessages;
}

/**
 * Compress messages using importance-based strategy
 */
export function compressImportanceBased(
  messages: ContextMessage[],
  targetTokens: number,
): ContextMessage[] {
  // Calculate importance for all messages
  const messagesWithImportance = messages.map((msg, idx) => ({
    ...msg,
    importance: calculateImportance(msg, idx, messages.length),
  }));

  // Sort by importance (descending)
  const sorted = [...messagesWithImportance].sort((a, b) => 
    (b.importance || 0) - (a.importance || 0)
  );

  // Keep most important messages that fit
  const result: ContextMessage[] = [];
  let currentTokens = 0;

  for (const msg of sorted) {
    if (currentTokens + msg.tokens <= targetTokens) {
      result.push(msg);
      currentTokens += msg.tokens;
    }
  }

  // Restore original order
  return result.sort((a, b) => {
    const aIdx = messages.findIndex(m => m === a);
    const bIdx = messages.findIndex(m => m === b);
    return aIdx - bIdx;
  });
}

/**
 * Compress messages using progressive summary strategy
 */
export function compressProgressiveSummary(
  messages: ContextMessage[],
  targetTokens: number,
  keepRecent: number,
): ContextMessage[] {
  const recentMessages = messages.slice(-keepRecent);
  const oldMessages = messages.slice(0, -keepRecent);

  if (oldMessages.length === 0) {
    return recentMessages;
  }

  // Group old messages into chunks and summarize each
  const chunkSize = Math.max(5, Math.floor(oldMessages.length / 3));
  const chunks: ContextMessage[][] = [];
  
  for (let i = 0; i < oldMessages.length; i += chunkSize) {
    chunks.push(oldMessages.slice(i, i + chunkSize));
  }

  const summaries: ContextMessage[] = [];
  const recentTokens = recentMessages.reduce((sum, msg) => sum + msg.tokens, 0);
  const budgetPerChunk = Math.floor((targetTokens - recentTokens) / chunks.length);

  for (const chunk of chunks) {
    const summary = summarizeMessages(chunk, budgetPerChunk);
    if (summary) {
      summaries.push({
        role: "system",
        content: summary,
        timestamp: chunk[0]?.timestamp || Date.now(),
        tokens: estimateTokens(summary),
        compressed: true,
        summary: summary,
        originalLength: chunk.length,
      });
    }
  }

  return [...summaries, ...recentMessages];
}

/**
 * Compress messages to fit target token budget
 */
export function compressToFit(messages: ContextMessage[], targetTokens: number): ContextMessage[] {
  const result: ContextMessage[] = [];
  let currentTokens = 0;

  // Keep messages from most recent backwards until we hit limit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (currentTokens + msg.tokens <= targetTokens) {
      result.unshift(msg);
      currentTokens += msg.tokens;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Compress context using configured strategy
 */
export function compressContext(
  messages: ContextMessage[],
  targetTokens: number,
  strategy: CompressionStrategy,
  keepRecent: number,
): ContextMessage[] {
  switch (strategy) {
    case "sliding-window":
      return compressSlidingWindow(messages, targetTokens, keepRecent);
    
    case "importance-based":
      return compressImportanceBased(messages, targetTokens);
    
    case "progressive-summary":
      return compressProgressiveSummary(messages, targetTokens, keepRecent);
    
    case "hybrid": {
      // Try sliding window first, then importance if still too large
      let compressed = compressSlidingWindow(messages, targetTokens, keepRecent);
      const compressedTokens = compressed.reduce((sum, msg) => sum + msg.tokens, 0);
      
      if (compressedTokens > targetTokens) {
        compressed = compressImportanceBased(compressed, targetTokens);
      }
      
      return compressed;
    }
    
    default:
      return compressToFit(messages, targetTokens);
  }
}
