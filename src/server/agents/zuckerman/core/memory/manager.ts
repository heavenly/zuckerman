/**
 * Unified Memory Manager
 * Coordinates all memory types and provides unified interface
 */

import { WorkingMemoryStore } from "./stores/working-store.js";
import { EpisodicMemoryStore } from "./stores/episodic-store.js";
import { SemanticMemoryStore } from "./stores/semantic-store.js";
import { ProceduralMemoryStore } from "./stores/procedural-store.js";
import { ProspectiveMemoryStore } from "./stores/prospective-store.js";
import { EmotionalMemoryStore } from "./stores/emotional-store.js";
import type {
  MemoryManager,
  MemoryType,
  WorkingMemory,
  EpisodicMemory,
  SemanticMemory,
  ProceduralMemory,
  ProspectiveMemory,
  EmotionalMemory,
  MemoryRetrievalOptions,
  MemoryRetrievalResult,
  BaseMemory,
} from "./types.js";

import { rememberMemoriesFromMessage } from "./memory-classifier.js";
import type { ResolvedMemorySearchConfig } from "./config.js";
import { initializeDatabase } from "./retrieval/db.js";
import { existsSync, readFileSync } from "node:fs";

export class UnifiedMemoryManager implements MemoryManager {
  private workingMemory: WorkingMemoryStore;
  private episodicMemory: EpisodicMemoryStore;
  private semanticMemory: SemanticMemoryStore;
  private proceduralMemory: ProceduralMemoryStore;
  private prospectiveMemory: ProspectiveMemoryStore;
  private emotionalMemory: EmotionalMemoryStore;

  private homedir?: string;
  private agentId?: string;
  private dbInitialized: boolean = false;

  constructor(homedir?: string, agentId?: string) {
    this.homedir = homedir;
    this.agentId = agentId || "zuckerman";

    this.workingMemory = new WorkingMemoryStore();
    this.episodicMemory = new EpisodicMemoryStore(this.agentId);
    this.semanticMemory = new SemanticMemoryStore(this.agentId);
    this.proceduralMemory = new ProceduralMemoryStore(this.agentId);
    this.prospectiveMemory = new ProspectiveMemoryStore(this.agentId);
    this.emotionalMemory = new EmotionalMemoryStore(this.agentId);
  }


  /**
   * Create a memory manager instance from homedir directory and agent ID
   */
  static create(homedir: string, agentId?: string): UnifiedMemoryManager {
    return new UnifiedMemoryManager(homedir, agentId);
  }

  /**
   * Initialize the vector database for memory search.
   * This should be called once when the agent starts, before any memory operations.
   */
  async initializeDatabase(
    config: ResolvedMemorySearchConfig,
    agentId: string,
  ): Promise<void> {
    if (this.dbInitialized) return;

    if (!this.homedir) {
      console.warn("[Memory] Cannot initialize database: homedir not set");
      return;
    }

    try {
      const embeddingCacheTable = "embedding_cache";
      const ftsTable = "fts_memory";

      initializeDatabase(
        config,
        this.homedir,
        agentId,
        embeddingCacheTable,
        ftsTable,
      );

      this.dbInitialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Memory] Failed to initialize database:`, message);
      // Don't throw - allow memory manager to work without vector search
    }
  }

  // ========== Internal Memory Management ==========
  // These methods are private and only used internally

  private addEpisodicMemory(
    memory: Omit<EpisodicMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.episodicMemory.add(memory);
  }

  private addSemanticMemory(
    memory: Omit<SemanticMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.semanticMemory.add(memory);
  }

  private addProceduralMemory(
    memory: Omit<ProceduralMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.proceduralMemory.add(memory);
  }

  private addProspectiveMemory(
    memory: Omit<ProspectiveMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.prospectiveMemory.add(memory);
  }

  private addEmotionalMemory(
    memory: Omit<EmotionalMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.emotionalMemory.add(memory);
  }


  // ========== Event-Driven Memory Methods ==========

  onSleepEnded(keepIds: string[]): void {
    const keep = new Set(keepIds);
    for (const m of this.semanticMemory.getAll()) {
      if (!keep.has(m.id)) this.semanticMemory.delete(m.id);
    }
    for (const m of this.episodicMemory.getAll()) {
      if (!keep.has(m.id)) this.episodicMemory.delete(m.id);
    }
    for (const m of this.proceduralMemory.getAll()) {
      if (!keep.has(m.id)) this.proceduralMemory.remove(m.id);
    }
    for (const m of this.prospectiveMemory.getAll()) {
      if (!keep.has(m.id)) this.prospectiveMemory.delete(m.id);
    }
  }

  async onNewMessage(userMessage: string, conversationContext?: string): Promise<void> {
    try {
      const result = await rememberMemoriesFromMessage(userMessage, conversationContext);
      if (!result.hasImportantInfo || result.memories.length === 0) return;

      const now = Date.now();
      for (const m of result.memories) {
        if (m.type === "semantic") {
          this.addSemanticMemory({ fact: m.content, confidence: m.importance });
        } else if (m.type === "episodic") {
          this.addEpisodicMemory({
            event: m.content,
            timestamp: now,
            context: { what: m.content, when: now, why: `Importance: ${m.importance.toFixed(2)}` },
          });
        } else if (m.type === "procedural") {
          this.addProceduralMemory({
            pattern: m.content,
            trigger: m.content,
            action: m.content,
            successRate: m.importance,
          });
        } else if (m.type === "prospective") {
          this.addProspectiveMemory({ intention: m.content, status: "pending", priority: m.importance });
        } else if (m.type === "emotional") {
          const semanticId = this.addSemanticMemory({ fact: m.content, confidence: m.importance });
          this.addEmotionalMemory({
            targetMemoryId: semanticId,
            targetMemoryType: "semantic",
            tag: {
              emotion: "neutral",
              intensity: m.importance > 0.7 ? "high" : m.importance > 0.5 ? "medium" : "low",
              timestamp: now,
            },
          });
        }
      }
    } catch (err) {
      console.warn(`[UnifiedMemoryManager] Memory remembering failed:`, err);
    }
  }

  /**
   * Set working memory
   */
  setWorkingMemory(content: string): void {
    this.workingMemory.set(content);
  }

  /**
   * Get working memory
   */
  getWorkingMemory(): { content: string } | null {
    const wm = this.workingMemory.get();
    return wm ? { content: wm.content } : null;
  }

  /**
   * Get all memories for consolidation
   */
  getAllMemories(): Array<{ id: string; type: MemoryType; content: string }> {
    const allMemories: Array<{ id: string; type: MemoryType; content: string }> = [];
    
    // Collect semantic memories
    for (const m of this.semanticMemory.getAll()) {
      allMemories.push({ id: m.id, type: "semantic", content: m.fact });
    }
    
    // Collect episodic memories
    for (const m of this.episodicMemory.getAll()) {
      allMemories.push({ id: m.id, type: "episodic", content: m.event });
    }
    
    // Collect procedural memories
    for (const m of this.proceduralMemory.getAll()) {
      allMemories.push({ id: m.id, type: "procedural", content: m.pattern });
    }
    
    // Collect prospective memories
    for (const m of this.prospectiveMemory.getAll()) {
      allMemories.push({ id: m.id, type: "prospective", content: m.intention });
    }
    
    return allMemories;
  }

  /**
   * Get relevant memories for a question/query
   * Fetches all memories from specified memory types
   */
  async getRelevantMemories(
    question: string,
    options?: {
      limit?: number;
      types?: MemoryType[];
    }
  ): Promise<MemoryRetrievalResult> {
    const allMemories: BaseMemory[] = [];
    const types = options?.types ?? ["semantic", "episodic", "procedural"];
    const limit = options?.limit ?? 20;

    // Fetch semantic memories (facts, knowledge)
    if (types.includes("semantic")) {
      const semanticMemories = this.semanticMemory.getAll();
      allMemories.push(...semanticMemories);
    }

    // Fetch episodic memories (events, experiences)
    if (types.includes("episodic")) {
      const episodicMemories = this.episodicMemory.getAll();
      allMemories.push(...episodicMemories);
    }

    // Fetch procedural memories (patterns, skills)
    if (types.includes("procedural")) {
      const proceduralMemories = this.proceduralMemory.getAll();
      allMemories.push(...proceduralMemories);
    }

    // Sort by recency (newest first)
    allMemories.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply final limit
    const limited = allMemories.slice(0, limit);

    return {
      memories: limited,
      total: allMemories.length,
    };
  }

}
