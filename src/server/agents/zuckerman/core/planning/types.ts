/**
 * Planning System Types
 * Task queue management and planning types
 */

/**
 * Task urgency level
 */
export type TaskUrgency = "low" | "medium" | "high" | "critical";

/**
 * Task type
 */
export type TaskType = "immediate" | "strategic" | "scheduled";

/**
 * Task source
 */
export type TaskSource = "user" | "prospective" | "self-generated";

/**
 * Task status
 */
export type TaskStatus = "pending" | "active" | "completed" | "cancelled" | "failed";

/**
 * Task - Represents a single task
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  type: TaskType;
  source: TaskSource;
  priority: number; // 0-1
  urgency: TaskUrgency;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  dependencies?: string[]; // Task IDs that must complete first
  metadata?: Record<string, unknown>; // Optional context
  progress?: number; // 0-100, for active tasks
  result?: unknown; // Execution result
  error?: string; // Error message if failed
  prospectiveMemoryId?: string; // Link to prospective memory if from that source
}

/**
 * Task Queue - Manages task collection
 */
export interface TaskQueue {
  pending: Task[]; // Sorted by priority
  active: Task | null; // Currently executing
  completed: Task[]; // Recently completed (limited)
  strategic: Task[]; // Long-term goals
}

/**
 * Planning statistics
 */
export interface PlanningStats {
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  averageCompletionTime: number; // milliseconds
  lastCompletedAt?: number;
}

/**
 * Planning State - Overall planning state per agent
 */
export interface PlanningState {
  agentId: string;
  queue: TaskQueue;
  currentTask: Task | null;
  lastSwitched: number;
  stats: PlanningStats;
}
