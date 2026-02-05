/**
 * Hierarchical Planning - Dependencies
 * Manages task dependencies and blocking
 */

import type { Task } from "../types.js";

/**
 * Dependency Manager
 */
export class DependencyManager {
  /**
   * Check if task dependencies are satisfied
   */
  areDependenciesSatisfied(task: Task, completedTaskIds: Set<string>): boolean {
    if (!task.dependencies || task.dependencies.length === 0) {
      return true;
    }

    return task.dependencies.every((depId) => completedTaskIds.has(depId));
  }

  /**
   * Filter tasks with satisfied dependencies
   */
  filterReadyTasks(tasks: Task[], completedTaskIds: Set<string>): Task[] {
    return tasks.filter((task) => this.areDependenciesSatisfied(task, completedTaskIds));
  }

  /**
   * Get blocking tasks (tasks that block this task)
   */
  getBlockingTasks(task: Task, allTasks: Task[]): Task[] {
    if (!task.dependencies || task.dependencies.length === 0) {
      return [];
    }

    return allTasks.filter((t) => task.dependencies!.includes(t.id));
  }

  /**
   * Get dependent tasks (tasks that depend on this task)
   */
  getDependentTasks(task: Task, allTasks: Task[]): Task[] {
    return allTasks.filter((t) => t.dependencies?.includes(task.id));
  }

  /**
   * Check if task is blocked
   */
  isBlocked(task: Task, completedTaskIds: Set<string>): boolean {
    return !this.areDependenciesSatisfied(task, completedTaskIds);
  }
}
