/**
 * Unified Memory Manager
 * Coordinates all memory types and provides unified interface
 */

import { join } from "node:path";
import { WorkingMemoryStore } from "./stores/working/index.js";
import { EpisodicMemoryStore } from "./stores/episodic/index.js";
import { ProceduralMemoryStore } from "./stores/procedural/index.js";
import { ProspectiveMemoryStore } from "./stores/prospective/index.js";
import { EmotionalMemoryStore } from "./stores/emotional/index.js";
import type {
  MemoryManager,
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
import {
  loadMemoryForConversation,
  appendDailyMemory,
  appendLongTermMemory,
} from "./services/storage/persistence.js";
import { extractMemoriesFromMessage } from "./services/extraction/index.js";
import type { LLMProvider } from "@server/world/providers/llm/types.js";

export class UnifiedMemoryManager implements MemoryManager {
  private workingMemory: WorkingMemoryStore;
  private episodicMemory: EpisodicMemoryStore;
  private proceduralMemory: ProceduralMemoryStore;
  private prospectiveMemory: ProspectiveMemoryStore;
  private emotionalMemory: EmotionalMemoryStore;
  private storageDir: string;
  private homedirDir?: string;
  private llmProvider?: LLMProvider;

  constructor(storageDir: string, homedirDir?: string, llmProvider?: LLMProvider) {
    this.storageDir = storageDir;
    this.homedirDir = homedirDir;
    this.llmProvider = llmProvider;
    this.workingMemory = new WorkingMemoryStore();
    this.episodicMemory = new EpisodicMemoryStore(storageDir);
    this.proceduralMemory = new ProceduralMemoryStore(storageDir);
    this.prospectiveMemory = new ProspectiveMemoryStore(storageDir);
    this.emotionalMemory = new EmotionalMemoryStore(storageDir);
  }

  // ========== Working Memory ==========
  // Active buffer for current task processing. Short-lived (minutes to hours), in-memory only. No file storage.

  setWorkingMemory(
    conversationId: string,
    content: string,
    context?: Record<string, unknown>
  ): void {
    this.workingMemory.set(conversationId, content, context);
  }

  getWorkingMemory(conversationId: string): WorkingMemory | null {
    return this.workingMemory.get(conversationId);
  }

  clearWorkingMemory(conversationId: string): void {
    this.workingMemory.clear(conversationId);
  }

  // ========== Episodic Memory ==========
  // Remembers specific events and experiences. Stored in episodic.json, also appended to daily logs. Decays over time (days to weeks).

  addEpisodicMemory(
    memory: Omit<EpisodicMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    const id = this.episodicMemory.add(memory);
    
    // Also append to daily log for backward compatibility
    if (this.homedirDir) {
      const content = `**Event**: ${memory.event}\n**When**: ${new Date(memory.timestamp).toISOString()}\n**What**: ${memory.context.what}${memory.context.why ? `\n**Why**: ${memory.context.why}` : ""}`;
      appendDailyMemory(this.homedirDir, content);
    }
    
    return id;
  }

  async getEpisodicMemories(
    options?: MemoryRetrievalOptions
  ): Promise<EpisodicMemory[]> {
    const results = this.episodicMemory.query({
      conversationId: options?.conversationId,
      startTime: options?.maxAge ? Date.now() - options.maxAge : undefined,
      limit: options?.limit,
      query: options?.query,
    });

    return results;
  }

  // ========== Semantic Memory ==========
  // Stores facts, knowledge, and concepts. Permanent storage, saved to MEMORY.md (or memory.md).

  addSemanticMemory(
    memory: Omit<SemanticMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    // For now, store in long-term memory file
    // TODO: Implement proper semantic memory storage
    if (this.homedirDir) {
      const content = `**Fact**: ${memory.fact}${memory.category ? `\n**Category**: ${memory.category}` : ""}${memory.confidence !== undefined ? `\n**Confidence**: ${memory.confidence}` : ""}`;
      appendLongTermMemory(this.homedirDir, content);
    }
    
    // Generate ID for tracking
    return `semantic_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async getSemanticMemories(
    options?: MemoryRetrievalOptions
  ): Promise<SemanticMemory[]> {
    // TODO: Implement proper semantic memory retrieval
    // For now, return empty array
    return [];
  }

  // ========== Procedural Memory ==========
  // Stores skills, habits, and automatic patterns. Improves with use, stored in procedural.json.

  addProceduralMemory(
    memory: Omit<ProceduralMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.proceduralMemory.add(memory);
  }

  async getProceduralMemories(trigger?: string): Promise<ProceduralMemory[]> {
    if (trigger) {
      return this.proceduralMemory.findMatching(trigger);
    }
    return this.proceduralMemory.getAll();
  }

  updateProceduralMemory(id: string, success: boolean): void {
    this.proceduralMemory.recordUse(id, success);
  }

  // ========== Prospective Memory ==========
  // Stores future intentions, reminders, and scheduled tasks. Triggers at specific times or contexts. Stored in prospective.json.

  addProspectiveMemory(
    memory: Omit<ProspectiveMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.prospectiveMemory.add(memory);
  }

  async getProspectiveMemories(
    options?: MemoryRetrievalOptions
  ): Promise<ProspectiveMemory[]> {
    return this.prospectiveMemory.query({
      conversationId: options?.conversationId,
      status: "pending",
      limit: options?.limit,
    });
  }

  triggerProspectiveMemory(id: string): void {
    this.prospectiveMemory.trigger(id);
  }

  completeProspectiveMemory(id: string): void {
    this.prospectiveMemory.complete(id);
  }

  // ========== Emotional Memory ==========
  // Stores emotional associations and reactions linked to other memories. Provides context for emotional responses. Stored in emotional.json.

  addEmotionalMemory(
    memory: Omit<EmotionalMemory, "id" | "type" | "createdAt" | "updatedAt">
  ): string {
    return this.emotionalMemory.add(memory);
  }

  async getEmotionalMemories(
    targetMemoryId?: string
  ): Promise<EmotionalMemory[]> {
    if (targetMemoryId) {
      return this.emotionalMemory.getByTarget(targetMemoryId);
    }
    return this.emotionalMemory.getAll();
  }

  // ========== Unified Retrieval ==========

  async retrieveMemories(
    options: MemoryRetrievalOptions
  ): Promise<MemoryRetrievalResult> {
    const allMemories: BaseMemory[] = [];
    const types = options.types ?? [
      "working",
      "episodic",
      "semantic",
      "procedural",
      "prospective",
      "emotional",
    ];

    // Collect memories from all requested types
    if (types.includes("working")) {
      const working = options.conversationId
        ? [this.workingMemory.get(options.conversationId)].filter(Boolean)
        : this.workingMemory.getAll();
      allMemories.push(...(working as BaseMemory[]));
    }

    if (types.includes("episodic")) {
      const episodic = await this.getEpisodicMemories(options);
      allMemories.push(...episodic);
    }

    if (types.includes("semantic")) {
      const semantic = await this.getSemanticMemories(options);
      allMemories.push(...semantic);
    }

    if (types.includes("procedural")) {
      const procedural = await this.getProceduralMemories(options.query);
      allMemories.push(...procedural);
    }

    if (types.includes("prospective")) {
      const prospective = await this.getProspectiveMemories(options);
      allMemories.push(...prospective);
    }

    if (types.includes("emotional")) {
      const emotional = await this.getEmotionalMemories();
      allMemories.push(...emotional);
    }

    // Sort by recency (newest first)
    allMemories.sort((a, b) => b.updatedAt - a.updatedAt);

    // Limit results
    let filtered = allMemories;
    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return {
      memories: filtered,
      total: allMemories.length,
    };
  }

  // ========== Cleanup ==========

  async cleanup(): Promise<void> {
    // Clear expired working memories
    this.clearExpiredWorkingMemory();
    
    // TODO: Clean up old episodic memories
    // TODO: Clean up completed prospective memories
  }

  clearExpiredWorkingMemory(): void {
    this.workingMemory.clearExpired();
  }

  // ========== Utility Methods ==========

  /**
   * Get due prospective memories (for periodic checking)
   */
  getDueProspectiveMemories(): ProspectiveMemory[] {
    return this.prospectiveMemory.getDue();
  }

  /**
   * Get prospective memories matching context
   */
  getProspectiveMemoriesByContext(context: string): ProspectiveMemory[] {
    return this.prospectiveMemory.getByContext(context);
  }

  // ========== Sleep Mode Integration ==========

  /**
   * Save consolidated memories from sleep mode
   * Creates structured episodic/semantic memories and also saves to files for backward compatibility
   */
  saveConsolidatedMemories(
    memories: Array<{
      content: string;
      type: "fact" | "preference" | "decision" | "event" | "learning";
      importance: number;
      shouldSaveToLongTerm: boolean;
    }>,
    conversationId?: string
  ): void {
    const now = Date.now();
    
    for (const memory of memories) {
      if (memory.shouldSaveToLongTerm) {
        // Save as semantic memory (long-term facts, preferences, learnings)
        this.addSemanticMemory({
          fact: memory.content,
          category: memory.type,
          confidence: memory.importance,
          source: conversationId,
        });
      } else {
        // Save as episodic memory (events, decisions)
        this.addEpisodicMemory({
          event: memory.type === "event" ? memory.content : `${memory.type}: ${memory.content}`,
          timestamp: now,
          context: {
            what: memory.content,
            when: now,
            why: `Importance: ${memory.importance.toFixed(2)}, Type: ${memory.type}`,
          },
          conversationId,
        });
      }
    }
  }

  // ========== Real-time Memory Extraction ==========

  /**
   * Process a new user message and extract/save important memories
   * This is called by the runtime when a new user message arrives
   */
  async onNewMessage(
    userMessage: string,
    conversationId?: string,
    conversationContext?: string
  ): Promise<void> {
    if (!this.llmProvider) {
      // No LLM provider available, skip extraction
      return;
    }

    try {
      const extractionResult = await extractMemoriesFromMessage(
        this.llmProvider,
        userMessage,
        conversationContext
      );

      if (extractionResult.hasImportantInfo && extractionResult.memories.length > 0) {
        this.saveExtractedMemories(extractionResult.memories, conversationId);
      }
    } catch (extractionError) {
      // Don't fail if extraction fails - just log and continue
      console.warn(`[UnifiedMemoryManager] Memory extraction failed:`, extractionError);
    }
  }

  /**
   * Save extracted memories from real-time extraction
   * Similar to saveConsolidatedMemories but optimized for immediate saving
   */
  private saveExtractedMemories(
    memories: Array<{
      type: "fact" | "preference" | "decision" | "event" | "learning";
      content: string;
      importance: number;
      shouldSaveToLongTerm: boolean;
      structuredData?: Record<string, unknown>;
    }>,
    conversationId?: string
  ): void {
    const now = Date.now();
    
    for (const memory of memories) {
      if (memory.shouldSaveToLongTerm) {
        // Save as semantic memory (long-term facts, preferences, learnings)
        // Use structured data if available for better fact extraction
        const fact = memory.structuredData 
          ? Object.entries(memory.structuredData)
              .filter(([k]) => k !== "field")
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ") || memory.content
          : memory.content;
        
        this.addSemanticMemory({
          fact,
          category: memory.type,
          confidence: memory.importance,
          source: conversationId,
        });
      } else {
        // Save as episodic memory (events, decisions)
        this.addEpisodicMemory({
          event: memory.type === "event" ? memory.content : `${memory.type}: ${memory.content}`,
          timestamp: now,
          context: {
            what: memory.content,
            when: now,
            why: `Importance: ${memory.importance.toFixed(2)}, Type: ${memory.type}`,
          },
          conversationId,
        });
      }
    }
  }
}
