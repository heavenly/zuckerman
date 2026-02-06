/**
 * Tree Manager
 * Manages the tree structure, CRUD operations, and tree queries
 */

import { randomUUID } from "node:crypto";
import type { GoalTaskNode, GoalTaskTree, GoalStatus, TaskStatus } from "../types.js";

export class TreeManager {
  private tree: GoalTaskTree;

  constructor() {
    this.tree = {
      root: null,
      nodes: new Map(),
      executionPath: [],
      activeNodeId: null,
    };
  }

  /**
   * Add node to tree
   */
  addNode(node: GoalTaskNode, parentId?: string): void {
    // Add to nodes map
    this.tree.nodes.set(node.id, node);

    // Set as root if no parent
    if (!parentId) {
      this.tree.root = node;
    } else {
      // Add to parent's children
      const parent = this.tree.nodes.get(parentId);
      if (parent) {
        parent.children.push(node);
        node.parentId = parentId;
        // Sort children by order
        parent.children.sort((a, b) => a.order - b.order);
      }
    }

    // Recalculate execution path
    this.recalculateExecutionPath();
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): GoalTaskNode | null {
    return this.tree.nodes.get(nodeId) || null;
  }

  /**
   * Clear children of a node (for re-decomposition)
   * Preserves completed children by default
   */
  clearChildren(nodeId: string, preserveCompleted: boolean = true): void {
    const node = this.tree.nodes.get(nodeId);
    if (!node) return;

    if (preserveCompleted) {
      // Only remove incomplete children
      const incompleteChildren = node.children.filter(child => {
        if (child.type === "goal") {
          return child.goalStatus !== "completed";
        } else {
          return child.taskStatus !== "completed" && child.taskStatus !== "active";
        }
      });

      // Remove incomplete children from tree
      incompleteChildren.forEach(child => {
        this.tree.nodes.delete(child.id);
      });

      // Update node's children array
      node.children = node.children.filter(child => {
        if (child.type === "goal") {
          return child.goalStatus === "completed";
        } else {
          return child.taskStatus === "completed" || child.taskStatus === "active";
        }
      });
    } else {
      // Remove all children
      node.children.forEach(child => {
        this.tree.nodes.delete(child.id);
      });
      node.children = [];
    }

    node.updatedAt = Date.now();
    this.recalculateExecutionPath();
  }

  /**
   * Get all leaf tasks (executable nodes)
   */
  getLeafTasks(): GoalTaskNode[] {
    const leaves: GoalTaskNode[] = [];
    const traverse = (node: GoalTaskNode) => {
      if (node.type === "task" && node.children.length === 0) {
        leaves.push(node);
      }
      node.children.forEach(traverse);
    };
    if (this.tree.root) {
      traverse(this.tree.root);
    }
    return leaves;
  }

  /**
   * Get children of a node
   */
  getChildren(nodeId: string): GoalTaskNode[] {
    const node = this.tree.nodes.get(nodeId);
    return node ? [...node.children] : [];
  }

  /**
   * Get ancestors (path to root)
   */
  getAncestors(nodeId: string): GoalTaskNode[] {
    const ancestors: GoalTaskNode[] = [];
    let current = this.tree.nodes.get(nodeId);
    while (current?.parentId) {
      const parent = this.tree.nodes.get(current.parentId);
      if (parent) {
        ancestors.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    return ancestors;
  }

  /**
   * Update node status
   */
  updateNodeStatus(nodeId: string, status: GoalStatus | TaskStatus): boolean {
    const node = this.tree.nodes.get(nodeId);
    if (!node) return false;

    if (node.type === "goal") {
      node.goalStatus = status as GoalStatus;
    } else {
      node.taskStatus = status as TaskStatus;
    }
    node.updatedAt = Date.now();

    // Recalculate parent progress if task completed
    if (status === "completed" && node.parentId) {
      this.updateParentProgress(node.parentId);
    }

    return true;
  }

  /**
   * Set active node
   */
  setActiveNode(nodeId: string | null): void {
    this.tree.activeNodeId = nodeId;
  }

  /**
   * Get active node
   */
  getActiveNode(): GoalTaskNode | null {
    if (!this.tree.activeNodeId) return null;
    return this.tree.nodes.get(this.tree.activeNodeId) || null;
  }

  /**
   * Recalculate execution path (simple order - LLM will decide priority)
   */
  private recalculateExecutionPath(): void {
    const leaves = this.getLeafTasks();
    // Simple order by creation time - LLM decides actual priority
    leaves.sort((a, b) => a.order - b.order);
    this.tree.executionPath = leaves.map((n) => n.id);
  }

  /**
   * Update parent goal progress from children
   */
  updateParentProgress(parentId: string): void {
    const parent = this.tree.nodes.get(parentId);
    if (!parent || parent.type !== "goal") return;

    const children = parent.children;
    if (children.length === 0) {
      parent.progress = parent.goalStatus === "completed" ? 100 : 0;
      return;
    }

    // Calculate progress from children
    const totalProgress = children.reduce((sum, child) => {
      if (child.type === "goal") {
        // For sub-goals, use their progress
        return sum + (child.progress || 0);
      } else {
        // For tasks, use progress or status
        if (child.taskStatus === "completed") {
          return sum + 100;
        }
        return sum + (child.progress || 0);
      }
    }, 0);

    parent.progress = Math.round(totalProgress / children.length);

    // Auto-complete goal if all children done
    if (parent.progress === 100 && parent.goalStatus !== "completed") {
      parent.goalStatus = "completed";
      parent.updatedAt = Date.now();
    }

    // Recursively update grandparent
    if (parent.parentId) {
      this.updateParentProgress(parent.parentId);
    }
  }

  /**
   * Update node progress
   */
  updateNodeProgress(nodeId: string, progress: number): boolean {
    const node = this.tree.nodes.get(nodeId);
    if (!node) return false;

    node.progress = Math.max(0, Math.min(100, progress));
    node.updatedAt = Date.now();

    // Update parent goals
    if (node.parentId) {
      this.updateParentProgress(node.parentId);
    }

    return true;
  }

  /**
   * Get all nodes as an array (for internal use)
   */
  getAllNodes(): GoalTaskNode[] {
    return Array.from(this.tree.nodes.values());
  }

  /**
   * Get tree structure
   */
  getTree(): GoalTaskTree {
    // Serialize Map to object for JSON compatibility
    const nodesObj: Record<string, GoalTaskNode> = {};
    for (const [id, node] of this.tree.nodes.entries()) {
      nodesObj[id] = { ...node };
    }
    
    return {
      root: this.tree.root ? { ...this.tree.root } : null,
      nodes: nodesObj as any, // Cast to any to maintain type compatibility
      executionPath: [...this.tree.executionPath],
      activeNodeId: this.tree.activeNodeId,
    };
  }

  /**
   * Initialize tree from existing structure
   */
  initializeTree(tree: GoalTaskTree): void {
    this.tree = {
      root: tree.root ? { ...tree.root } : null,
      nodes: new Map(tree.nodes),
      executionPath: [...tree.executionPath],
      activeNodeId: tree.activeNodeId,
    };
  }
}
