/**
 * Temporal Planning - Task ordering
 * Orders tasks by time and sequence
 */

import type { Task, TaskUrgency } from "../types.js";

/**
 * Temporal Ordering
 */
export class TemporalOrdering {
  /**
   * Calculate priority based on temporal factors
   */
  calculateTemporalPriority(task: Task): number {
    let priority = 0.0;

    // Task age (older tasks get slight boost)
    const age = Date.now() - task.createdAt;
    const ageHours = age / (1000 * 60 * 60);
    const ageBoost = Math.min(0.2, ageHours / 24); // Max 0.2 boost for 24+ hours
    priority += ageBoost * 0.1;

    // Scheduled tasks get priority boost when due
    if (task.type === "scheduled") {
      const triggerTime = task.metadata?.triggerTime as number | undefined;
      if (triggerTime && Date.now() >= triggerTime) {
        priority += 0.3; // Boost when due
      }
    }

    return Math.max(0, Math.min(1, priority));
  }

  /**
   * Order tasks by creation time (FIFO within same priority)
   */
  orderByCreationTime(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Order tasks by urgency then time
   */
  orderByUrgencyThenTime(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
      const urgencyDiff = this.getUrgencyLevel(b.urgency) - this.getUrgencyLevel(a.urgency);
      if (urgencyDiff !== 0) {
        return urgencyDiff;
      }
      return a.createdAt - b.createdAt; // FIFO within same urgency
    });
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
}
