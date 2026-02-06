import type { BaseMemory, SemanticMemory, EpisodicMemory, ProceduralMemory, MemoryRetrievalResult } from "./types.js";

/**
 * Format a single memory into text representation for prompts
 */
function formatMemory(mem: BaseMemory): string {
  switch (mem.type) {
    case "semantic": {
      const s = mem as SemanticMemory;
      const prefix = s.category ? `${s.category}: ` : "";
      return `[Semantic] ${prefix}${s.fact}`;
    }
    case "episodic": {
      const e = mem as EpisodicMemory;
      return `[Episodic] ${e.event}: ${e.context.what}`;
    }
    case "procedural": {
      const p = mem as ProceduralMemory;
      return `[Procedural] ${p.pattern}: ${p.action}`;
    }
    default: {
      return `[${mem.type}] ${JSON.stringify(mem)}`;
    }
  }
}

/**
 * Format memory retrieval results as text for LLM prompts
 */
export function formatMemoriesForPrompt(memoryResult: MemoryRetrievalResult): string {
  if (memoryResult.memories.length === 0) {
    return "";
  }

  const memoryParts = memoryResult.memories.map(formatMemory);
  return `\n\n## Relevant Memories\n${memoryParts.join("\n")}`;
}
