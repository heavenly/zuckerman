/**
 * Sleep mode processor - analyzes conversation history
 */

import type { ContextMessage, ConsolidatedMemory } from "./types.js";

/**
 * Process conversation to identify important memories
 */
export function processConversation(messages: ContextMessage[]): {
  importantMessages: ContextMessage[];
  summary: string;
} {
  // Filter for important messages (user queries, assistant responses with decisions, tool results)
  const importantMessages = messages.filter(msg => {
    if (msg.role === "user") return true;
    if (msg.role === "assistant" && msg.tokens > 100) return true; // Substantial responses
    if (msg.role === "tool") return true;
    return false;
  });

  // Create a summary of the conversation
  const summary = createConversationSummary(messages);

  return {
    importantMessages,
    summary,
  };
}

/**
 * Create a summary of the conversation
 */
function createConversationSummary(messages: ContextMessage[]): string {
  const userMessages = messages.filter(m => m.role === "user");
  const assistantMessages = messages.filter(m => m.role === "assistant");
  
  const topics: string[] = [];
  
  // Extract topics from user messages
  for (const msg of userMessages.slice(0, 10)) { // Last 10 user messages
    const content = msg.content.trim();
    if (content.length > 20 && content.length < 200) {
      topics.push(content);
    }
  }
  
  return topics.length > 0 
    ? `Recent conversation topics:\n${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : `Processed ${messages.length} messages in conversation.`;
}

/**
 * Categorize memories by type
 */
export function categorizeMemory(content: string): ConsolidatedMemory["type"] {
  const lower = content.toLowerCase();
  
  // Check for preferences
  if (lower.includes("prefer") || lower.includes("like") || lower.includes("favorite")) {
    return "preference";
  }
  
  // Check for decisions
  if (lower.includes("decide") || lower.includes("choose") || lower.includes("will")) {
    return "decision";
  }
  
  // Check for events
  if (lower.includes("happened") || lower.includes("event") || lower.includes("occurred")) {
    return "event";
  }
  
  // Check for learnings
  if (lower.includes("learned") || lower.includes("understand") || lower.includes("realized")) {
    return "learning";
  }
  
  // Default to fact
  return "fact";
}
