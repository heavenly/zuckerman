/**
 * Working Memory - Active buffer for current task processing
 * In-memory only, cleared after task completion
 */

import { randomUUID } from "node:crypto";
import type { WorkingMemory } from "../types.js";

export class WorkingMemoryStore {
  private memory: WorkingMemory | null = null;
  private readonly defaultTtl = 60 * 60 * 1000; // 1 hour default TTL

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
  }

  /**
   * Clear working memory
   */
  clear(): void {
    this.memory = null;
  }

  /**
   * Clear all expired working memories
   */
  clearExpired(): void {
    if (this.memory && this.memory.expiresAt && this.memory.expiresAt < Date.now()) {
      this.memory = null;
    }
  }

  /**
   * Clear all working memories
   */
  clearAll(): void {
    this.memory = null;
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
