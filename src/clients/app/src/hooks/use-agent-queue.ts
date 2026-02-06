import { useState, useEffect, useRef } from "react";
import { GatewayClient } from "../core/gateway/client";
import type { GatewayEvent } from "../core/gateway/types";

/**
 * Goal/Task Node - matches backend GoalTaskNode structure
 */
export interface GoalTaskNode {
  id: string;
  type: "goal" | "task";
  title: string;
  description?: string;
  
  // Goal-specific fields (only when type === "goal")
  goalStatus?: "active" | "completed" | "paused" | "cancelled";
  targetDate?: number;
  progress?: number;
  
  // Task-specific fields (only when type === "task")
  urgency?: "low" | "medium" | "high" | "critical";
  priority?: number;
  taskStatus?: "pending" | "active" | "completed" | "cancelled" | "failed";
  
  // Tree structure
  parentId?: string;
  children: GoalTaskNode[];
  order: number;
  
  // Common fields
  source: "user" | "prospective" | "self-generated";
  createdAt: number;
  updatedAt: number;
  
  // Execution tracking
  result?: unknown;
  error?: string;
  prospectiveMemoryId?: string;
  
  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Goal-Task Tree
 * Note: nodes is serialized as object (not Map) when sent over JSON
 */
export interface GoalTaskTree {
  root: GoalTaskNode | null;
  nodes: Map<string, GoalTaskNode> | Record<string, GoalTaskNode> | GoalTaskNode[];
  executionPath: string[];
  activeNodeId: string | null;
}

/**
 * Task - flattened view for UI compatibility
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  type: "goal" | "task";
  source: "user" | "prospective" | "self-generated";
  priority?: number;
  urgency?: "low" | "medium" | "high" | "critical";
  status: "pending" | "active" | "completed" | "cancelled" | "failed" | "paused";
  createdAt: number;
  updatedAt: number;
  progress?: number;
  result?: unknown;
  error?: string;
  parentId?: string;
  children?: GoalTaskNode[];
}

export interface TaskQueue {
  pending: Task[];
  active: Task | null;
  completed: Task[];
  strategic: Task[];
}

export interface PlanningStats {
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  averageCompletionTime: number;
  lastCompletedAt?: number;
}

export interface PlanningState {
  agentId: string;
  tree: GoalTaskTree;
  currentNode: GoalTaskNode | null;
  lastSwitched: number;
  stats: PlanningStats;
  // UI compatibility fields (added by transformPlanningState)
  queue?: TaskQueue;
  currentTask?: Task | null;
}

/**
 * Transform PlanningState with tree to UI-compatible format
 */
function transformPlanningState(state: PlanningState): PlanningState & { queue: TaskQueue; currentTask: Task | null } {
  const queue = extractTasksFromTree(state.tree, state.currentNode);
  const currentTask = state.currentNode && state.currentNode.type === "task"
    ? nodeToTask(state.currentNode)
    : null;

  return {
    ...state,
    queue,
    currentTask,
  };
}

/**
 * Convert GoalTaskNode to Task
 */
function nodeToTask(node: GoalTaskNode): Task {
  return {
    id: node.id,
    title: node.title,
    description: node.description,
    type: node.type,
    source: node.source,
    priority: node.priority,
    urgency: node.urgency,
    status: node.type === "goal" 
      ? (node.goalStatus || "active") as Task["status"]
      : (node.taskStatus || "pending") as Task["status"],
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    progress: node.progress,
    result: node.result,
    error: node.error,
    parentId: node.parentId,
    children: node.children.length > 0 ? node.children : undefined,
  };
}

/**
 * Extract tasks from tree structure for UI display
 */
function extractTasksFromTree(tree: GoalTaskTree, currentNode: GoalTaskNode | null): TaskQueue {
  const pending: Task[] = [];
  const completed: Task[] = [];
  const strategic: Task[] = [];
  
  // Handle Map serialization - backend sends as object (Record<string, GoalTaskNode>), convert to array
  let nodesArray: GoalTaskNode[] = [];
  
  try {
    if (tree.nodes && typeof tree.nodes === "object") {
      // Check if it's a Map (has .entries method and is instance of Map)
      if (tree.nodes instanceof Map && typeof (tree.nodes as Map<string, GoalTaskNode>).values === "function") {
        // If it's actually a Map (shouldn't happen after JSON serialization, but handle it)
        nodesArray = Array.from((tree.nodes as Map<string, GoalTaskNode>).values());
      } else if (Array.isArray(tree.nodes)) {
        // If it's already an array
        nodesArray = tree.nodes;
      } else {
        // If it's an object (Record<string, GoalTaskNode>) - this is what we get from JSON
        // Convert object to array of values
        const nodesObj = tree.nodes as Record<string, GoalTaskNode>;
        nodesArray = Object.keys(nodesObj).map(key => nodesObj[key]).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn("[extractTasksFromTree] Failed to convert nodes to array:", e, "nodes type:", typeof tree.nodes, "nodes:", tree.nodes);
    nodesArray = [];
  }

  // Traverse all nodes in the tree
  const visited = new Set<string>();
  const traverse = (node: GoalTaskNode) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);

    // Only process leaf tasks (tasks without children) or goals
    const isLeaf = node.children.length === 0;
    
    if (node.type === "task" && isLeaf) {
      const task = nodeToTask(node);
      
      if (task.status === "completed") {
        completed.push(task);
      } else if (task.status === "pending") {
        pending.push(task);
      } else if (task.status === "active") {
        // Active task is handled separately
      }
    } else if (node.type === "goal") {
      // Goals can be strategic
      const goal = nodeToTask(node);
      if (goal.status === "active" && goal.children && goal.children.length > 0) {
        strategic.push(goal);
      }
    }

    // Recursively process children
    for (const child of node.children) {
      traverse(child);
    }
  };

  // Start traversal from root
  if (tree.root) {
    traverse(tree.root);
  }

  // Also traverse all nodes in the array (in case root is null)
  for (const node of nodesArray) {
    if (!visited.has(node.id)) {
      traverse(node);
    }
  }

  // Sort by creation time (newest first)
  pending.sort((a, b) => b.createdAt - a.createdAt);
  completed.sort((a, b) => b.updatedAt - a.updatedAt);
  strategic.sort((a, b) => b.createdAt - a.createdAt);

  // Get active task
  const active = currentNode && currentNode.type === "task" 
    ? nodeToTask(currentNode)
    : null;

  return {
    pending,
    active,
    completed: completed.slice(0, 10), // Limit recent completed
    strategic,
  };
}

/**
 * SWR Pattern Hook: Stale-While-Revalidate
 * - Shows loading only on initial mount when no data exists
 * - All subsequent updates happen silently via events
 * - Background refetches don't trigger loading states
 */
export function useAgentQueue(agentId: string | null, gatewayClient: GatewayClient | null, enabled: boolean = true) {
  const [queueState, setQueueState] = useState<PlanningState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  
  const mountedRef = useRef(true);
  const loadedAgentsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !agentId || !gatewayClient?.isConnected()) {
      return;
    }

    mountedRef.current = true;
    let cleanup: (() => void) | null = null;

    // SWR: Check if we need initial load using functional state update
    let needsInitialLoad = false;
    setQueueState((current) => {
      const hasDataForAgent = current?.agentId === agentId;
      const hasLoadedBefore = loadedAgentsRef.current.has(agentId);
      needsInitialLoad = !hasDataForAgent && !hasLoadedBefore;

      // Reset state when switching to a different agent
      if (current && current.agentId !== agentId) {
        needsInitialLoad = true;
        return null;
      }
      return current;
    });

    if (needsInitialLoad) {
      setLoading(true);
      setError(null);
    }

    const fetchQueue = async () => {
      // Re-check current state to determine if initial load
      let isInitialLoad = false;
      setQueueState((current) => {
        isInitialLoad = !current || current.agentId !== agentId;
        return current;
      });
      
      if (!isInitialLoad) {
        setError(null); // Clear error on background refresh
      }

      try {
        // Start streaming mode
        const response = await gatewayClient.request("agent.queue", {
          agentId,
          stream: true,
        });

        if (!mountedRef.current) return;

        if (response.ok && response.result) {
          const result = response.result as { queue: PlanningState; streaming: boolean };
          // Transform tree structure to queue format for UI compatibility
          const transformedState = transformPlanningState(result.queue);
          setQueueState(transformedState);
          setLastFetchedAt(Date.now());
          loadedAgentsRef.current.add(agentId);
        } else {
          // SWR: Only set error if we don't have existing data (keep showing stale data)
          if (isInitialLoad) {
            setError(response.error?.message || "Failed to fetch queue");
          }
        }
      } catch (err) {
        if (!mountedRef.current) return;
        
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch queue";
        // SWR: Only set error if we don't have existing data (keep showing stale data)
        if (isInitialLoad) {
          setError(errorMessage);
        }
        console.error("[useAgentQueue] Error fetching queue:", err);
      } finally {
        if (isInitialLoad && mountedRef.current) {
          setLoading(false);
        }
      }
    };

    // Set up event listener for queue updates (primary update mechanism)
    const handleEvent = (event: GatewayEvent) => {
      if (event.event === "agent.queue.update") {
        const payload = event.payload as { agentId: string; queue: PlanningState; timestamp: number };
        if (payload.agentId === agentId && mountedRef.current) {
          // Transform tree structure to queue format for UI compatibility
          const transformedState = transformPlanningState(payload.queue);
          setQueueState(transformedState);
          setLastFetchedAt(payload.timestamp || Date.now());
          loadedAgentsRef.current.add(agentId);
          // Clear error when we receive successful updates via events
          setError(null);
        }
      }
    };

    if (gatewayClient) {
      cleanup = gatewayClient.addEventListener(handleEvent);
      fetchQueue();
    }

    return () => {
      mountedRef.current = false;
      if (cleanup) {
        cleanup();
      }
    };
  }, [agentId, gatewayClient, enabled]);

  return {
    queueState,
    loading,
    error,
    lastFetchedAt,
    refetch: async () => {
      if (!agentId || !gatewayClient?.isConnected()) return;
      
      // SWR: Silent background refetch, don't set loading
      setError(null);
      try {
        const response = await gatewayClient.request("agent.queue", { agentId });
        if (response.ok && response.result) {
          const result = response.result as { agentId: string; queue: PlanningState; timestamp: number };
          // Transform tree structure to queue format for UI compatibility
          const transformedState = transformPlanningState(result.queue);
          setQueueState(transformedState);
          setLastFetchedAt(result.timestamp || Date.now());
          loadedAgentsRef.current.add(agentId);
        } else {
          // Only set error if we don't have existing data
          if (!queueState || queueState.agentId !== agentId) {
            setError(response.error?.message || "Failed to fetch queue");
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch queue";
        // Only set error if we don't have existing data
        if (!queueState || queueState.agentId !== agentId) {
          setError(errorMessage);
        }
      }
    },
  };
}
