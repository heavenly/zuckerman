/**
 * Strategic Planning - Long-term goals management
 * Manages strategic goals and high-level planning
 */

import type { Task } from "../types.js";

/**
 * Strategic Planning Manager
 */
export class StrategicManager {
  /**
   * Calculate priority for strategic tasks
   */
  calculateStrategicPriority(task: Task): number {
    let priority = 0.0;

    // Strategic tasks get base priority boost
    if (task.type === "strategic") {
      priority += 0.3; // Higher base for strategic
    }

    // Long-term importance factor
    // Strategic tasks are less urgent but more important
    priority += 0.2;

    return Math.max(0, Math.min(1, priority));
  }

  /**
   * Check if task is strategic
   */
  isStrategic(task: Task): boolean {
    return task.type === "strategic";
  }

  /**
   * Promote immediate task to strategic
   */
  promoteToStrategic(task: Task): Task {
    return {
      ...task,
      type: "strategic",
      updatedAt: Date.now(),
    };
  }
}
