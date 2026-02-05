/**
 * Reactive Planning - Task switching
 * Handles task switching logic with LLM-based continuity assessment
 */

import type { Task, TaskUrgency } from "../types.js";
import type { FocusState } from "../../attention/types.js";
import { FocusContinuityAnalyzer, type ContinuityAssessment } from "./continuity.js";

/**
 * Task context for resumption
 */
export interface TaskContext {
  taskId: string;
  savedAt: number;
  context: Record<string, unknown>;
}

/**
 * Task Switcher
 */
export class TaskSwitcher {
  private savedContexts: Map<string, TaskContext> = new Map();
  private switchHistory: Array<{ from: string; to: string; timestamp: number }> = [];
  private continuityAnalyzer: FocusContinuityAnalyzer;

  constructor() {
    this.continuityAnalyzer = new FocusContinuityAnalyzer();
  }

  /**
   * Determine if should switch from current task to new task (LLM-based)
   */
  async shouldSwitchWithLLM(
    currentTask: Task | null,
    newTask: Task,
    currentFocus: FocusState | null
  ): Promise<ContinuityAssessment> {
    return await this.continuityAnalyzer.assessContinuity(
      currentFocus,
      currentTask,
      newTask
    );
  }

  /**
   * Determine if should switch from current task to new task (legacy rule-based, kept for fallback)
   */
  shouldSwitch(currentTask: Task | null, newTask: Task): boolean {
    // No current task - can switch
    if (!currentTask) {
      return true;
    }

    // Same task - don't switch
    if (currentTask.id === newTask.id) {
      return false;
    }

    // Critical tasks always interrupt
    if (newTask.urgency === "critical") {
      return true;
    }

    // Higher urgency can interrupt lower urgency
    const currentUrgencyLevel = this.getUrgencyLevel(currentTask.urgency);
    const newUrgencyLevel = this.getUrgencyLevel(newTask.urgency);

    if (newUrgencyLevel > currentUrgencyLevel) {
      return true;
    }

    // Can't interrupt if new task has same or lower urgency
    return false;
  }

  /**
   * Get urgency level as number for comparison (legacy, kept for fallback)
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
   * Perform task switch
   */
  switchTask(fromTask: Task | null, toTask: Task): void {
    // Save context of current task if exists
    if (fromTask) {
      this.saveTaskContext(fromTask.id, {
        progress: fromTask.progress || 0,
        status: fromTask.status,
        metadata: fromTask.metadata || {},
      });
    }

    // Record switch in history
    this.switchHistory.push({
      from: fromTask?.id || "none",
      to: toTask.id,
      timestamp: Date.now(),
    });

    // Limit history size
    if (this.switchHistory.length > 100) {
      this.switchHistory.shift();
    }
  }

  /**
   * Get switch history
   */
  getSwitchHistory(): Array<{ from: string; to: string; timestamp: number }> {
    return [...this.switchHistory];
  }

  /**
   * Save task context for resumption
   */
  saveTaskContext(taskId: string, context: Record<string, unknown>): void {
    this.savedContexts.set(taskId, {
      taskId,
      savedAt: Date.now(),
      context,
    });
  }

  /**
   * Get saved task context
   */
  getTaskContext(taskId: string): TaskContext | null {
    return this.savedContexts.get(taskId) || null;
  }

  /**
   * Clear saved context for task
   */
  clearContext(taskId: string): void {
    this.savedContexts.delete(taskId);
  }
}
