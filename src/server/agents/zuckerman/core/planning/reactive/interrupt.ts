/**
 * Reactive Planning - Interruption handling
 * Handles task interruptions
 */

import type { Task, TaskUrgency } from "../types.js";

/**
 * Interruption Handler
 */
export class InterruptionHandler {
  /**
   * Check if task can be interrupted
   */
  canInterrupt(task: Task): boolean {
    // Critical tasks cannot be interrupted (except by other critical)
    if (task.urgency === "critical") {
      return false;
    }

    // Active tasks can be interrupted by higher urgency
    return true;
  }

  /**
   * Check if new task can interrupt current task
   */
  canInterruptTask(currentTask: Task, newTask: Task): boolean {
    if (!this.canInterrupt(currentTask)) {
      return false;
    }

    // Critical always interrupts
    if (newTask.urgency === "critical") {
      return true;
    }

    // Higher urgency interrupts lower
    const currentLevel = this.getUrgencyLevel(currentTask.urgency);
    const newLevel = this.getUrgencyLevel(newTask.urgency);

    return newLevel > currentLevel;
  }

  /**
   * Get urgency level as number
   */
  private getUrgencyLevel(urgency: TaskUrgency): number {
    const levels: Record<TaskUrgency, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    return levels[urgency];
  }

  /**
   * Handle interruption - prepare task for resumption
   */
  prepareForInterruption(task: Task): Record<string, unknown> {
    return {
      progress: task.progress || 0,
      status: task.status,
      metadata: task.metadata || {},
      interruptedAt: Date.now(),
    };
  }
}
