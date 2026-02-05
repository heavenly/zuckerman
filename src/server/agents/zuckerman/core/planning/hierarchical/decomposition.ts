/**
 * Hierarchical Planning - Task decomposition
 * Breaks down tasks into sub-tasks
 */

import type { Task } from "../types.js";

/**
 * Task decomposition result
 */
export interface DecompositionResult {
  subTasks: Task[];
  parentTaskId: string;
}

/**
 * Task Decomposer
 */
export class TaskDecomposer {
  /**
   * Decompose task into sub-tasks
   * Simple implementation - can be enhanced with LLM
   */
  decompose(task: Task): DecompositionResult {
    const subTasks: Task[] = [];

    // Simple heuristic: if task has "and" or multiple verbs, might need decomposition
    // For now, return empty (can be enhanced)
    
    return {
      subTasks,
      parentTaskId: task.id,
    };
  }

  /**
   * Check if task should be decomposed
   */
  shouldDecompose(task: Task): boolean {
    // Simple heuristic: complex tasks might need decomposition
    const complexity = this.estimateComplexity(task);
    return complexity > 0.7;
  }

  /**
   * Estimate task complexity (0-1)
   */
  private estimateComplexity(task: Task): number {
    let complexity = 0.0;

    // Longer descriptions = more complex
    if (task.description) {
      const wordCount = task.description.split(/\s+/).length;
      complexity += Math.min(0.4, wordCount / 50);
    }

    // Multiple dependencies = more complex
    if (task.dependencies && task.dependencies.length > 0) {
      complexity += Math.min(0.3, task.dependencies.length / 5);
    }

    // Strategic tasks = more complex
    if (task.type === "strategic") {
      complexity += 0.3;
    }

    return Math.min(1.0, complexity);
  }
}
