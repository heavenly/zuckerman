/**
 * Smart Memory Remembering Service
 * Uses LLM to intelligently detect and remember important information from user messages
 */

import type { LLMMessage } from "@server/world/providers/llm/types.js";
import { LLMManager } from "@server/world/providers/llm/index.js";

export interface RememberedMemory {
  type: "fact" | "preference" | "decision" | "event" | "learning";
  content: string;
  importance: number; // 0-1
  structuredData?: Record<string, unknown>; // e.g., {name: "dvir", field: "name"}
}

export interface RememberResult {
  memories: RememberedMemory[];
  memoriesByCategory: {
    fact?: RememberedMemory[];
    preference?: RememberedMemory[];
    decision?: RememberedMemory[];
    event?: RememberedMemory[];
    learning?: RememberedMemory[];
  };
  hasImportantInfo: boolean;
}

/**
 * Remember important memories from a user message using LLM
 */
export async function rememberMemoriesFromMessage(
  userMessage: string,
  conversationContext?: string
): Promise<RememberResult> {
  // Select model for memory remembering (fastCheap for efficiency)
  const llmManager = LLMManager.getInstance();
  const model = await llmManager.fastCheap();
  const systemPrompt = `You are the part of the brain that estimates what information is important enough to remember. Like the hippocampus and prefrontal cortex working together, you evaluate incoming information and determine what should be stored in memory for future recall.

You assess and categorize:
- Facts: Personal information (name, age, location, etc.), factual statements worth remembering
- Preferences: Likes, dislikes, preferences, opinions that define the person
- Decisions: Important choices, commitments, plans that matter
- Events: Significant happenings, milestones worth preserving
- Learning: New knowledge, insights, lessons that add value

You only mark information as important if it:
1. Is explicitly stated or clearly implied
2. Has value for future conversations and interactions
3. Is not trivial or already well-established

Your assessment should be returned as a JSON object grouped by category. The structure should be:
{
  "fact": [{"content": "...", "importance": 0.8, "structuredData": {...}}],
  "preference": [{"content": "...", "importance": 0.7}],
  "decision": [{"content": "...", "importance": 0.6}],
  "event": [{"content": "...", "importance": 0.5}],
  "learning": [{"content": "...", "importance": 0.8}]
}

Each memory object should include:
- content: The information to remember (concise, clear)
- importance: 0-1 score representing how critical this is (0.7+ for very important, 0.5-0.7 for moderately important)
- structuredData: Optional structured fields for better recall (e.g., {"name": "alex", "field": "name"} for "my name is alex")

Only include categories that have memories. If nothing is important enough to remember, return an empty object {}.

Examples:
- "remember my name is alex" → {"preference": [{"content": "name is alex", "importance": 0.9, "structuredData": {"name": "alex", "field": "name"}}]}
- "I like coffee" → {"preference": [{"content": "likes coffee", "importance": 0.7}]}
- "I'll call you tomorrow" → {"decision": [{"content": "will call tomorrow", "importance": 0.6}]}
- "hello" → {}

Return ONLY valid JSON object, no other text.`;

  const messages: LLMMessage[] = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: conversationContext
        ? `Context: ${conversationContext}\n\nUser message: ${userMessage}`
        : userMessage,
    },
  ];

  try {
    const response = await model.call({
      messages,
      temperature: 0.3, // Low temperature for consistent remembering
      maxTokens: 500, // Small response for remembering
    });

    const content = response.content.trim();
    
    // Parse JSON object grouped by categories
    // Remove markdown code blocks if present
    const jsonMatch = content.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    const parsed = JSON.parse(jsonStr);
    
    // Validate structure - should be an object
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { memories: [], memoriesByCategory: {}, hasImportantInfo: false };
    }
    
    // Process each category
    const memoriesByCategory: RememberResult["memoriesByCategory"] = {};
    const memories: RememberedMemory[] = [];
    const validCategories = ["fact", "preference", "decision", "event", "learning"];
    
    for (const category of validCategories) {
      if (parsed[category] && Array.isArray(parsed[category])) {
        const categoryMemories = parsed[category]
          .filter((m: unknown) => {
            return (
              m &&
              typeof m === "object" &&
              typeof (m as RememberedMemory).content === "string" &&
              typeof (m as RememberedMemory).importance === "number"
            );
          })
          .map((m: Record<string, unknown>) => ({
            type: category as RememberedMemory["type"],
            content: m.content as string,
            importance: m.importance as number,
            structuredData: m.structuredData as Record<string, unknown> | undefined,
          }));
        
        if (categoryMemories.length > 0) {
          memoriesByCategory[category as keyof typeof memoriesByCategory] = categoryMemories;
          memories.push(...categoryMemories);
        }
      }
    }

    return {
      memories,
      memoriesByCategory,
      hasImportantInfo: memories.length > 0,
    };
  } catch (error) {
    console.error(`[MemoryRemember] Error remembering memories:`, error);
    throw error;
  }
}
