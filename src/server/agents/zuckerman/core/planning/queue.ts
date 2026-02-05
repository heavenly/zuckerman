/**
 * Task Queue Manager
 * Manages task queue operations
 */

import { randomUUID } from "node:crypto";
import type { Task, TaskQueue } from "./types.js";

/**
 * Task Queue Manager
 */
export class TaskQueueManager {
  private queue: TaskQueue;

  constructor() {
    this.queue = {
      pending: [],
      active: null,
      completed: [],
      strategic: [],
    };
  }

  /**
   * Add task to queue
   */
  addTask(task: Omit<Task, "id" | "status" | "createdAt" | "updatedAt"> | Task): string {
    // If task already has an id, use it (for re-adding interrupted tasks)
    let id: string;
    let newTask: Task;

    if ("id" in task && task.id && "createdAt" in task && task.createdAt) {
      // Task already has ID (re-adding interrupted task)
      id = task.id;
      newTask = {
        ...task,
        status: task.status || "pending",
        updatedAt: task.updatedAt || Date.now(),
      } as Task;
    } else {
      // New task
      id = randomUUID();
      const now = Date.now();
      newTask = {
        ...task,
        id,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      } as Task;
    }

    if (newTask.type === "strategic") {
      this.queue.strategic.push(newTask);
    } else {
      this.queue.pending.push(newTask);
    }

    return id;
  }

  /**
   * Get next task from queue (highest priority pending)
   */
  getNextTask(): Task | null {
    if (this.queue.pending.length === 0) {
      return null;
    }

    // Return highest priority task (already sorted)
    return this.queue.pending[0];
  }

  /**
   * Start task execution
   */
  startTask(taskId: string): boolean {
    const taskIndex = this.queue.pending.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) {
      return false;
    }

    const task = this.queue.pending[taskIndex];
    task.status = "active";
    task.updatedAt = Date.now();
    task.progress = 0;

    // Remove from pending and set as active
    this.queue.pending.splice(taskIndex, 1);
    this.queue.active = task;

    return true;
  }

  /**
   * Complete task
   */
  completeTask(taskId: string, result?: unknown): boolean {
    const task = this.queue.active;
    if (!task || task.id !== taskId) {
      return false;
    }

    task.status = "completed";
    task.updatedAt = Date.now();
    task.progress = 100;
    task.result = result;

    // Move to completed
    this.queue.active = null;
    this.queue.completed.push(task);

    // Limit completed tasks (keep last 50)
    if (this.queue.completed.length > 50) {
      this.queue.completed.shift();
    }

    return true;
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string): boolean {
    // Check pending
    const pendingIndex = this.queue.pending.findIndex((t) => t.id === taskId);
    if (pendingIndex !== -1) {
      const task = this.queue.pending[pendingIndex];
      task.status = "cancelled";
      task.updatedAt = Date.now();
      this.queue.pending.splice(pendingIndex, 1);
      return true;
    }

    // Check active
    if (this.queue.active?.id === taskId) {
      this.queue.active.status = "cancelled";
      this.queue.active.updatedAt = Date.now();
      this.queue.active = null;
      return true;
    }

    // Check strategic
    const strategicIndex = this.queue.strategic.findIndex((t) => t.id === taskId);
    if (strategicIndex !== -1) {
      const task = this.queue.strategic[strategicIndex];
      task.status = "cancelled";
      task.updatedAt = Date.now();
      this.queue.strategic.splice(strategicIndex, 1);
      return true;
    }

    return false;
  }

  /**
   * Fail task
   */
  failTask(taskId: string, error: string): boolean {
    const task = this.queue.active;
    if (!task || task.id !== taskId) {
      return false;
    }

    task.status = "failed";
    task.updatedAt = Date.now();
    task.error = error;

    // Move to completed with failed status
    this.queue.active = null;
    this.queue.completed.push(task);

    // Limit completed tasks
    if (this.queue.completed.length > 50) {
      this.queue.completed.shift();
    }

    return true;
  }

  /**
   * Get queue state
   */
  getQueue(): TaskQueue {
    return {
      pending: [...this.queue.pending],
      active: this.queue.active ? { ...this.queue.active } : null,
      completed: [...this.queue.completed],
      strategic: [...this.queue.strategic],
    };
  }

  /**
   * Get pending tasks
   */
  getPendingTasks(): Task[] {
    return [...this.queue.pending];
  }

  /**
   * Get strategic goals
   */
  getStrategicGoals(): Task[] {
    return [...this.queue.strategic];
  }

  /**
   * Get active task
   */
  getActiveTask(): Task | null {
    return this.queue.active ? { ...this.queue.active } : null;
  }

  /**
   * Update task progress
   */
  updateProgress(taskId: string, progress: number): boolean {
    const task = this.queue.active;
    if (!task || task.id !== taskId) {
      return false;
    }

    task.progress = Math.max(0, Math.min(100, progress));
    task.updatedAt = Date.now();
    return true;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | null {
    // Check active
    if (this.queue.active?.id === taskId) {
      return { ...this.queue.active };
    }

    // Check pending
    const pending = this.queue.pending.find((t) => t.id === taskId);
    if (pending) {
      return { ...pending };
    }

    // Check strategic
    const strategic = this.queue.strategic.find((t) => t.id === taskId);
    if (strategic) {
      return { ...strategic };
    }

    // Check completed
    const completed = this.queue.completed.find((t) => t.id === taskId);
    if (completed) {
      return { ...completed };
    }

    return null;
  }

  /**
   * Update pending tasks array (for reprioritization)
   */
  setPendingTasks(tasks: Task[]): void {
    this.queue.pending = tasks;
  }
}
