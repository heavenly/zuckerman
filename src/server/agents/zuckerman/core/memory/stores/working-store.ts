/**
 * Working Memory - Active buffer for current task processing
 * Persisted to file for recovery
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentMemoryStorePath } from "@server/world/homedir/paths.js";
import type { WorkingMemory } from "../types.js";

export interface WorkingMemoryStorage {
  memories: WorkingMemory[];
}

export class WorkingMemoryStore {
  private memory: WorkingMemory | null = null;
  private readonly defaultTtl = 60 * 60 * 1000; // 1 hour default TTL
  private storagePath: string;

  constructor(agentId: string) {
    this.storagePath = getAgentMemoryStorePath(agentId, "working");
    this.load();
  }

  /**
   * Load working memory from file
   */
  private load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;

    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const data = JSON.parse(raw) as WorkingMemoryStorage;
      
      if (data.memories && data.memories.length > 0) {
        // Get the most recent non-expired memory
        const now = Date.now();
        const active = data.memories
          .filter(m => !m.expiresAt || m.expiresAt >= now)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        
        this.memory = active || null;
      }
    } catch (error) {
      console.warn(`Failed to load working memory from ${this.storagePath}:`, error);
    }
  }

  /**
   * Save working memory to file
   */
  private save(): void {
    if (!this.storagePath) return;

    try {
      const dir = dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: WorkingMemoryStorage = {
        memories: this.memory ? [this.memory] : [],
      };

      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.warn(`Failed to save working memory to ${this.storagePath}:`, error);
    }
  }

  /**
   * Set working memory
   */
  set(content: string, context?: Record<string, unknown>, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTtl);
    
    const memory: WorkingMemory = {
      id: randomUUID(),
      type: "working",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      content,
      context: context ?? {},
      expiresAt,
    };

    this.memory = memory;
    this.save();
  }

  /**
   * Get working memory
   */
  get(): WorkingMemory | null {
    if (!this.memory) return null;
    
    // Check if expired
    if (this.memory.expiresAt && this.memory.expiresAt < Date.now()) {
      this.memory = null;
      return null;
    }
    
    return this.memory;
  }

  /**
   * Update working memory content
   */
  update(updates: Partial<Pick<WorkingMemory, "content" | "context">>): void {
    if (!this.memory) return;

    this.memory = {
      ...this.memory,
      ...updates,
      updatedAt: Date.now(),
    };
    this.save();
  }

  /**
   * Clear working memory
   */
  clear(): void {
    this.memory = null;
    this.save();
  }

  /**
   * Clear all expired working memories
   */
  clearExpired(): void {
    if (this.memory && this.memory.expiresAt && this.memory.expiresAt < Date.now()) {
      this.memory = null;
      this.save();
    }
  }

  /**
   * Clear all working memories
   */
  clearAll(): void {
    this.memory = null;
    this.save();
  }

  /**
   * Get all active working memories
   */
  getAll(): WorkingMemory[] {
    if (!this.memory) return [];
    
    const now = Date.now();
    if (this.memory.expiresAt && this.memory.expiresAt < now) {
      return [];
    }
    
    return [this.memory];
  }
}
