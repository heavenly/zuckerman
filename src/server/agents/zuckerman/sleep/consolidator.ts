/**
 * Sleep mode consolidator - organizes and prepares memories for storage
 */

import type { ConsolidatedMemory, ContextMessage } from "./types.js";
import { calculateImportance } from "./summarizer.js";
import { categorizeMemory } from "./processor.js";

/**
 * Consolidate memories from conversation
 */
export function consolidateMemories(
  messages: ContextMessage[],
  conversationSummary: string,
): ConsolidatedMemory[] {
  const memories: ConsolidatedMemory[] = [];
  
  // Add conversation summary as a memory
  memories.push({
    content: conversationSummary,
    type: "event",
    importance: 0.7,
    shouldSaveToLongTerm: false, // Daily log only
  });
  
  // Process important messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Skip compressed/summarized messages
    if (msg.compressed) continue;
    
    // Only process user and assistant messages with substantial content
    if (msg.role === "user" || (msg.role === "assistant" && msg.tokens > 50)) {
      const importance = calculateImportance(msg, i, messages.length);
      
      // Only include if importance is above threshold
      if (importance > 0.4) {
        const type = categorizeMemory(msg.content);
        const shouldSaveToLongTerm = importance > 0.7 && (
          type === "preference" || 
          type === "fact" || 
          type === "learning"
        );
        
        memories.push({
          content: msg.content,
          type,
          importance,
          shouldSaveToLongTerm,
        });
      }
    }
  }
  
  // Sort by importance (descending)
  return memories.sort((a, b) => b.importance - a.importance);
}

/**
 * Format memories for daily log
 */
export function formatMemoriesForDailyLog(memories: ConsolidatedMemory[]): string {
  const dailyMemories = memories.filter(m => !m.shouldSaveToLongTerm);
  
  if (dailyMemories.length === 0) {
    return "";
  }
  
  const sections: string[] = [];
  
  // Group by type
  const byType: Record<ConsolidatedMemory["type"], ConsolidatedMemory[]> = {
    fact: [],
    preference: [],
    decision: [],
    event: [],
    learning: [],
  };
  
  for (const memory of dailyMemories) {
    byType[memory.type].push(memory);
  }
  
  // Format each type
  for (const [type, mems] of Object.entries(byType)) {
    if (mems.length > 0) {
      sections.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      for (const mem of mems) {
        sections.push(`- ${mem.content}`);
      }
    }
  }
  
  return sections.join("\n\n");
}

/**
 * Format memories for long-term storage
 */
export function formatMemoriesForLongTerm(memories: ConsolidatedMemory[]): string {
  const longTermMemories = memories.filter(m => m.shouldSaveToLongTerm);
  
  if (longTermMemories.length === 0) {
    return "";
  }
  
  const sections: string[] = [];
  
  // Group by type
  const byType: Record<ConsolidatedMemory["type"], ConsolidatedMemory[]> = {
    fact: [],
    preference: [],
    decision: [],
    event: [],
    learning: [],
  };
  
  for (const memory of longTermMemories) {
    byType[memory.type].push(memory);
  }
  
  // Format each type
  for (const [type, mems] of Object.entries(byType)) {
    if (mems.length > 0) {
      sections.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      for (const mem of mems) {
        sections.push(`- ${mem.content}`);
      }
    }
  }
  
  return sections.join("\n\n");
}
