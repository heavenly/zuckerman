/**
 * Temporal Planning - Time-based scheduling
 * Manages scheduled tasks and time triggers
 */

import type { Task } from "../types.js";

/**
 * Temporal Scheduler
 */
export class TemporalScheduler {
  /**
   * Check if scheduled task is due
   */
  isDue(task: Task): boolean {
    if (task.type !== "scheduled") {
      return false;
    }

    const triggerTime = task.metadata?.triggerTime as number | undefined;
    if (!triggerTime) {
      return false;
    }

    return Date.now() >= triggerTime;
  }

  /**
   * Get time until task is due (milliseconds)
   */
  getTimeUntilDue(task: Task): number | null {
    if (task.type !== "scheduled") {
      return null;
    }

    const triggerTime = task.metadata?.triggerTime as number | undefined;
    if (!triggerTime) {
      return null;
    }

    return Math.max(0, triggerTime - Date.now());
  }

  /**
   * Filter tasks that are due
   */
  filterDueTasks(tasks: Task[]): Task[] {
    return tasks.filter((task) => this.isDue(task));
  }

  /**
   * Sort tasks by due time (earliest first)
   */
  sortByDueTime(tasks: Task[]): Task[] {
    return tasks
      .filter((task) => task.type === "scheduled")
      .sort((a, b) => {
        const timeA = (a.metadata?.triggerTime as number) || Infinity;
        const timeB = (b.metadata?.triggerTime as number) || Infinity;
        return timeA - timeB;
      });
  }
}
