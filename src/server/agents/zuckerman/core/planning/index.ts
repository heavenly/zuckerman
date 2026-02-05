/**
 * Planning System
 * Task queue management and planning
 */

import type { Task, PlanningState, PlanningStats } from "./types.js";
import type { MemoryManager } from "../memory/types.js";
import type { FocusState, UrgencyLevel } from "../attention/types.js";
import type { TaskStep } from "./tactical/steps.js";
import { TaskQueueManager } from "./queue.js";
import { DependencyManager } from "./hierarchical/index.js";
import { TacticalExecutor, StepSequenceManager } from "./tactical/index.js";
import { TaskSwitcher } from "./reactive/index.js";
import { TemporalScheduler } from "./temporal/index.js";
import { FallbackStrategyManager } from "./contingency/index.js";
import { scoreRelevance } from "../attention/selective/index.js";

/**
 * Planning Manager
 * Orchestrates all planning components
 */
export class PlanningManager {
  private agentId: string;
  private queueManager: TaskQueueManager;
  private dependencyManager: DependencyManager;
  private executor: TacticalExecutor;
  private switcher: TaskSwitcher;
  private scheduler: TemporalScheduler;
  private fallbackManager: FallbackStrategyManager;
  private stepManager: StepSequenceManager;
  private stats: PlanningStats;
  private currentFocus: FocusState | null = null;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.queueManager = new TaskQueueManager();
    this.dependencyManager = new DependencyManager();
    this.executor = new TacticalExecutor();
    this.switcher = new TaskSwitcher();
    this.scheduler = new TemporalScheduler();
    this.fallbackManager = new FallbackStrategyManager();
    this.stepManager = new StepSequenceManager();
    this.stats = {
      totalCompleted: 0,
      totalFailed: 0,
      totalCancelled: 0,
      averageCompletionTime: 0,
    };
  }

  /**
   * Set current focus state (from attention system)
   */
  setFocus(focus: FocusState | null): void {
    this.currentFocus = focus;
  }

  /**
   * Decompose task into steps using tactical planning (LLM-based)
   */
  async decomposeTask(
    message: string,
    urgency: UrgencyLevel,
    focus: FocusState | null
  ): Promise<TaskStep[]> {
    return await this.stepManager.decomposeWithLLM(message, urgency, focus);
  }

  /**
   * Add task to queue
   */
  addTask(task: Omit<Task, "id" | "status" | "createdAt" | "updatedAt" | "priority">): string {
    // Calculate priority based on urgency (from attention system)
    const priority = this.calculatePriorityFromUrgency(task.urgency);

    const taskId = this.queueManager.addTask({
      ...task,
      priority,
    });

    // Re-prioritize queue based on attention focus
    this.reprioritizeQueue();

    return taskId;
  }

  /**
   * Calculate priority from urgency level (attention-based)
   */
  private calculatePriorityFromUrgency(urgency: Task["urgency"]): number {
    const urgencyWeights: Record<Task["urgency"], number> = {
      critical: 1.0,
      high: 0.8,
      medium: 0.5,
      low: 0.3,
    };
    return urgencyWeights[urgency];
  }

  /**
   * Process queue - get next task to execute
   */
  processQueue(): Task | null {
    const queue = this.queueManager.getQueue();
    const completedIds = new Set(
      queue.completed.filter((t) => t.status === "completed").map((t) => t.id)
    );

    // Filter ready tasks (dependencies satisfied)
    const readyTasks = this.dependencyManager.filterReadyTasks(queue.pending, completedIds);

    if (readyTasks.length === 0) {
      return null;
    }

    // Prioritize ready tasks using attention system
    const prioritized = this.prioritizeByAttention(readyTasks);

    // Get current task
    const currentTask = this.executor.getCurrentTask();

    // Check if should switch
    const nextTask = prioritized[0];
    if (currentTask && !this.switcher.shouldSwitch(currentTask, nextTask)) {
      return currentTask; // Continue current task
    }

    // Switch to new task if needed
    if (currentTask && this.switcher.shouldSwitch(currentTask, nextTask)) {
      // Save context of current task before switching
      this.switcher.saveTaskContext(currentTask.id, {
        progress: currentTask.progress || 0,
        status: currentTask.status,
        metadata: currentTask.metadata || {},
      });

      // Mark current task as pending (interrupted) and add back to queue
      const interruptedTask: Task = {
        ...currentTask,
        status: "pending",
        updatedAt: Date.now(),
      };
      this.queueManager.addTask(interruptedTask);

      // Clear executor
      this.executor.clear();
      this.switcher.switchTask(currentTask, nextTask);
    }

    // Start new task
    this.queueManager.startTask(nextTask.id);
    const activeTask = this.queueManager.getActiveTask();
    if (activeTask) {
      this.executor.startExecution(activeTask);
    }

    return activeTask;
  }

  /**
   * Get current task
   */
  getCurrentTask(): Task | null {
    return this.executor.getCurrentTask() || this.queueManager.getActiveTask();
  }

  /**
   * Complete current task
   */
  completeCurrentTask(result?: unknown): boolean {
    const currentTask = this.executor.getCurrentTask();
    if (!currentTask) {
      return false;
    }

    const executionTime = this.executor.getExecutionTime() || 0;
    this.executor.completeExecution(currentTask, result);
    this.queueManager.completeTask(currentTask.id, result);

    // Update stats
    this.updateStats("completed", executionTime);
    this.switcher.clearContext(currentTask.id);

    return true;
  }

  /**
   * Fail current task
   */
  failCurrentTask(error: string): boolean {
    const currentTask = this.executor.getCurrentTask();
    if (!currentTask) {
      return false;
    }

    this.executor.failExecution(currentTask, error);
    this.queueManager.failTask(currentTask.id, error);

    // Try fallback strategy
    const fallbackTask = this.fallbackManager.handleFailure(currentTask, error);
    if (fallbackTask) {
      // Add fallback task to queue (use queueManager directly since task already has ID)
      this.queueManager.addTask(fallbackTask);
      // Re-prioritize queue
      this.reprioritizeQueue();
    }

    // Update stats
    this.updateStats("failed", 0);
    this.switcher.clearContext(currentTask.id);

    return true;
  }

  /**
   * Update task progress
   */
  updateProgress(progress: number): boolean {
    const currentTask = this.executor.getCurrentTask();
    if (!currentTask) {
      return false;
    }

    this.executor.updateProgress(currentTask, progress);
    this.queueManager.updateProgress(currentTask.id, progress);
    return true;
  }

  /**
   * Complete current step (tactical planning)
   */
  completeCurrentStep(result?: unknown): boolean {
    return this.executor.completeCurrentStep(result);
  }

  /**
   * Get current step (tactical planning)
   */
  getCurrentStep(): TaskStep | null {
    return this.executor.getCurrentStep();
  }

  /**
   * Get all steps for current task
   */
  getSteps(): TaskStep[] {
    return this.executor.getSteps();
  }

  /**
   * Check if current step requires confirmation
   */
  currentStepRequiresConfirmation(): boolean {
    const step = this.executor.getCurrentStep();
    return step?.requiresConfirmation || false;
  }

  /**
   * Handle step failure with contingency planning
   */
  async handleStepFailure(step: TaskStep, error: string): Promise<Task | null> {
    const currentTask = this.executor.getCurrentTask();
    if (!currentTask) {
      return null;
    }

    // Try fallback strategy
    const fallbackTask = this.fallbackManager.handleFailure(currentTask, error);
    if (fallbackTask) {
      // Add fallback task to queue (use queueManager directly since task already has ID)
      this.queueManager.addTask(fallbackTask);
      // Re-prioritize queue
      this.reprioritizeQueue();
      return fallbackTask;
    }

    return null;
  }

  /**
   * Get queue state
   */
  getQueueState(): PlanningState {
    const queue = this.queueManager.getQueue();
    const currentTask = this.getCurrentTask();

    return {
      agentId: this.agentId,
      queue,
      currentTask,
      lastSwitched: this.switcher.getSwitchHistory()[this.switcher.getSwitchHistory().length - 1]?.timestamp || 0,
      stats: { ...this.stats },
    };
  }

  /**
   * Integrate with Prospective Memory
   * Load tasks from prospective memory
   */
  async integrateProspectiveMemory(memoryManager: MemoryManager): Promise<void> {
    try {
      const prospectiveMemories = await memoryManager.getProspectiveMemories({
        limit: 100,
      });

      for (const memory of prospectiveMemories) {
        if (memory.status !== "pending") {
          continue;
        }

        // Check if task already exists
        const existingTask = this.queueManager.getTask(memory.id);
        if (existingTask) {
          continue;
        }

        // Convert prospective memory to task
        const urgency: Task["urgency"] = (memory.priority || 0) >= 0.8 ? "high" : (memory.priority || 0) >= 0.5 ? "medium" : "low";

        this.addTask({
          title: memory.intention,
          description: `From prospective memory: ${memory.intention}`,
          type: memory.triggerTime ? "scheduled" : "immediate",
          source: "prospective",
          urgency,
          prospectiveMemoryId: memory.id,
          metadata: {
            triggerTime: memory.triggerTime,
            triggerContext: memory.triggerContext,
          },
        });
      }

      // Check for due scheduled tasks
      const queue = this.queueManager.getQueue();
      const dueTasks = this.scheduler.filterDueTasks(queue.pending);
      for (const task of dueTasks) {
        // Tasks are already in queue, scheduler just identifies them
      }
    } catch (error) {
      console.warn(`[Planning] Failed to integrate prospective memory:`, error);
    }
  }

  /**
   * Sync task completion back to Prospective Memory
   */
  async syncWithProspectiveMemory(memoryManager: MemoryManager): Promise<void> {
    const queue = this.queueManager.getQueue();
    const completed = queue.completed.filter((t) => t.prospectiveMemoryId);

    for (const task of completed) {
      if (task.prospectiveMemoryId && task.status === "completed") {
        try {
          memoryManager.completeProspectiveMemory(task.prospectiveMemoryId);
        } catch (error) {
          console.warn(`[Planning] Failed to sync task ${task.id} to prospective memory:`, error);
        }
      }
    }
  }

  /**
   * Register fallback plan for a task
   */
  registerFallback(taskId: string, fallbackDescription: string, priority: number = 0.5): string {
    return this.fallbackManager.registerFallback(taskId, fallbackDescription, priority);
  }

  /**
   * Prioritize tasks using attention system
   */
  private prioritizeByAttention(tasks: Task[]): Task[] {
    // Score tasks by relevance to current focus
    const tasksWithScores = tasks.map((task) => {
      let priority = this.calculatePriorityFromUrgency(task.urgency);

      // Boost priority if task matches current focus
      if (this.currentFocus) {
        const taskContent = `${task.title} ${task.description || ""}`;
        const relevance = scoreRelevance(taskContent, this.currentFocus);
        
        // If task matches focus topic, boost priority
        if (relevance.score > 0.5) {
          priority += relevance.score * 0.3;
        }

        // If task matches current task from focus, boost more
        if (this.currentFocus.currentTask && task.title.toLowerCase().includes(this.currentFocus.currentTask.toLowerCase())) {
          priority += 0.2;
        }
      }

      // Source weight (user requests prioritized)
      const sourceWeight = task.source === "user" ? 0.1 : task.source === "prospective" ? 0.05 : 0.0;
      priority += sourceWeight;

      // Dependencies reduce priority
      if (task.dependencies && task.dependencies.length > 0) {
        priority *= 0.8;
      }

      return {
        task,
        priority: Math.max(0, Math.min(1, priority)),
      };
    });

    // Sort by priority (highest first), then by creation time (oldest first)
    tasksWithScores.sort((a, b) => {
      const priorityDiff = b.priority - a.priority;
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.task.createdAt - b.task.createdAt; // FIFO within same priority
    });

    // Update task priorities and return sorted tasks
    return tasksWithScores.map((item) => {
      item.task.priority = item.priority;
      return item.task;
    });
  }

  /**
   * Reprioritize queue
   */
  private reprioritizeQueue(): void {
    const queue = this.queueManager.getQueue();
    const prioritized = this.prioritizeByAttention(queue.pending);
    this.queueManager.setPendingTasks(prioritized);
  }

  /**
   * Update statistics
   */
  private updateStats(status: "completed" | "failed" | "cancelled", executionTime: number): void {
    if (status === "completed") {
      this.stats.totalCompleted++;
      this.stats.lastCompletedAt = Date.now();

      // Update average completion time
      const total = this.stats.totalCompleted;
      const currentAvg = this.stats.averageCompletionTime;
      this.stats.averageCompletionTime = (currentAvg * (total - 1) + executionTime) / total;
    } else if (status === "failed") {
      this.stats.totalFailed++;
    } else if (status === "cancelled") {
      this.stats.totalCancelled++;
    }
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string): boolean {
    const cancelled = this.queueManager.cancelTask(taskId);
    if (cancelled) {
      this.updateStats("cancelled", 0);
      this.switcher.clearContext(taskId);
    }
    return cancelled;
  }
}

// Export types and classes
export * from "./types.js";
export { TaskQueueManager } from "./queue.js";
export { TacticalExecutor } from "./tactical/index.js";
export { TaskSwitcher } from "./reactive/index.js";
export { TemporalScheduler } from "./temporal/index.js";
export { FallbackStrategyManager } from "./contingency/index.js";
export { DependencyManager } from "./hierarchical/index.js";

// Export planning type modules
export * from "./strategic/index.js";
export * from "./tactical/index.js";
export * from "./hierarchical/index.js";
export * from "./reactive/index.js";
export * from "./temporal/index.js";
export * from "./contingency/index.js";
