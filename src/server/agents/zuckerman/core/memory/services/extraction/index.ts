/**
 * Smart Memory Extraction Service
 * Uses LLM to intelligently detect and extract important information from user messages
 */

import type { LLMProvider } from "@server/world/providers/llm/types.js";
import type { LLMMessage } from "@server/world/providers/llm/types.js";

export interface ExtractedMemory {
  type: "fact" | "preference" | "decision" | "event" | "learning";
  content: string;
  importance: number; // 0-1
  shouldSaveToLongTerm: boolean;
  structuredData?: Record<string, unknown>; // e.g., {name: "dvir", field: "name"}
}

export interface ExtractionResult {
  memories: ExtractedMemory[];
  hasImportantInfo: boolean;
}

/**
 * Extract important memories from a user message using LLM
 */
export async function extractMemoriesFromMessage(
  provider: LLMProvider,
  userMessage: string,
  conversationContext?: string
): Promise<ExtractionResult> {
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

Your assessment should be returned as a JSON array. Each memory evaluation should include:
- type: "fact" | "preference" | "decision" | "event" | "learning"
- content: The information to remember (concise, clear)
- importance: 0-1 score representing how critical this is (0.7+ for very important, 0.5-0.7 for moderately important)
- shouldSaveToLongTerm: true for facts/preferences/learnings (semantic memory), false for events/decisions (episodic memory)
- structuredData: Optional structured fields for better recall (e.g., {"name": "alex", "field": "name"} for "my name is alex")

If nothing is important enough to remember, return an empty array.

Examples:
- "remember my name is alex" → [{"type": "preference", "content": "name is alex", "importance": 0.9, "shouldSaveToLongTerm": true, "structuredData": {"name": "alex", "field": "name"}}]
- "I like coffee" → [{"type": "preference", "content": "likes coffee", "importance": 0.7, "shouldSaveToLongTerm": true}]
- "I'll call you tomorrow" → [{"type": "decision", "content": "will call tomorrow", "importance": 0.6, "shouldSaveToLongTerm": false}]
- "hello" → []

Return ONLY valid JSON array, no other text.`;

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
    // Try to use a smaller/faster model for extraction if available
    // Fallback to default model if specific model not available
    let extractionModel = { id: "gpt-4o-mini" };
    
    const response = await provider.call({
      messages,
      temperature: 0.3, // Low temperature for consistent extraction
      maxTokens: 500, // Small response for extraction
      model: extractionModel,
    });

    const content = response.content.trim();
    
    // Try to parse JSON array
    let memories: ExtractedMemory[] = [];
    try {
      // Remove markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\[.*?\])\s*```/s);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      memories = JSON.parse(jsonStr);
      
      // Validate structure
      if (!Array.isArray(memories)) {
        return { memories: [], hasImportantInfo: false };
      }
      
      // Validate each memory has required fields
      memories = memories.filter((m) => {
        return (
          m &&
          typeof m === "object" &&
          ["fact", "preference", "decision", "event", "learning"].includes(m.type) &&
          typeof m.content === "string" &&
          typeof m.importance === "number" &&
          typeof m.shouldSaveToLongTerm === "boolean"
        );
      });
    } catch (parseError) {
      // If parsing fails, try to extract from text response
      console.warn(`[MemoryExtraction] Failed to parse JSON, trying text extraction:`, parseError);
      
      // Simple fallback: check if response indicates important info
      const lowerContent = content.toLowerCase();
      if (
        lowerContent.includes("no important") ||
        lowerContent.includes("nothing to") ||
        lowerContent.includes("empty array") ||
        lowerContent === "[]"
      ) {
        return { memories: [], hasImportantInfo: false };
      }
      
      // If response exists but isn't parseable, assume extraction failed
      return { memories: [], hasImportantInfo: false };
    }

    return {
      memories,
      hasImportantInfo: memories.length > 0,
    };
  } catch (error) {
    console.error(`[MemoryExtraction] Error extracting memories:`, error);
    return { memories: [], hasImportantInfo: false };
  }
}
