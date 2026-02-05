/**
 * Contingency Planning - Alternative plans
 * Manages alternative plans for tasks
 */

import type { Task } from "../types.js";

/**
 * Alternative plan
 */
export interface AlternativePlan {
  id: string;
  taskId: string;
  description: string;
  priority: number; // 0-1
  conditions?: string[]; // When to use this alternative
}

/**
 * Alternative Plans Manager
 */
export class AlternativePlansManager {
  private alternatives: Map<string, AlternativePlan[]> = new Map();

  /**
   * Add alternative plan for a task
   */
  addAlternative(taskId: string, alternative: Omit<AlternativePlan, "id" | "taskId">): string {
    const id = `${taskId}-alt-${Date.now()}`;
    const alt: AlternativePlan = {
      ...alternative,
      id,
      taskId,
    };

    const existing = this.alternatives.get(taskId) || [];
    existing.push(alt);
    this.alternatives.set(taskId, existing);

    return id;
  }

  /**
   * Get alternatives for a task
   */
  getAlternatives(taskId: string): AlternativePlan[] {
    return [...(this.alternatives.get(taskId) || [])];
  }

  /**
   * Get best alternative for a task
   */
  getBestAlternative(taskId: string): AlternativePlan | null {
    const alternatives = this.getAlternatives(taskId);
    if (alternatives.length === 0) {
      return null;
    }

    // Sort by priority (highest first)
    return alternatives.sort((a, b) => b.priority - a.priority)[0];
  }

  /**
   * Check if task has alternatives
   */
  hasAlternatives(taskId: string): boolean {
    return (this.alternatives.get(taskId)?.length || 0) > 0;
  }
}
