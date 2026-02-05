/**
 * Contingency Planning - Fallback strategies
 * Handles fallback plans when tasks fail
 */

import type { Task } from "../types.js";
import { AlternativePlansManager, type AlternativePlan } from "./alternatives.js";

/**
 * Fallback Strategy Manager
 */
export class FallbackStrategyManager {
  private alternativesManager: AlternativePlansManager;

  constructor() {
    this.alternativesManager = new AlternativePlansManager();
  }

  /**
   * Handle task failure - get fallback plan
   */
  handleFailure(task: Task, error: string): Task | null {
    // Check if task has alternatives
    const alternatives = this.alternativesManager.getAlternatives(task.id);
    if (alternatives.length === 0) {
      return null; // No fallback
    }

    // Get best alternative
    const bestAlt = this.alternativesManager.getBestAlternative(task.id);
    if (!bestAlt) {
      return null;
    }

    // Create fallback task from alternative
    const fallbackTask: Task = {
      ...task,
      id: `${task.id}-fallback-${Date.now()}`,
      title: bestAlt.description,
      description: `Fallback for: ${task.title}. Original error: ${error}`,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        ...task.metadata,
        isFallback: true,
        originalTaskId: task.id,
        originalError: error,
      },
    };

    return fallbackTask;
  }

  /**
   * Register fallback plan for a task
   */
  registerFallback(taskId: string, fallbackDescription: string, priority: number = 0.5): string {
    return this.alternativesManager.addAlternative(taskId, {
      description: fallbackDescription,
      priority,
    });
  }

  /**
   * Check if task has fallback
   */
  hasFallback(taskId: string): boolean {
    return this.alternativesManager.hasAlternatives(taskId);
  }
}
