import type { ZuckermanAwareness } from "./runtime.js";

/**
 * Followup run to be processed
 */
export interface FollowupRun {
  prompt: string;
  run: {
    conversationId: string;
    model?: any;
    temperature?: number;
    securityContext?: any;
    stream?: any;
    [key: string]: any;
  };
  enqueuedAt: number;
}

/**
 * Queue state for a conversation
 */
interface QueueState {
  items: FollowupRun[];
  draining: boolean;
  lastEnqueuedAt: number;
  busy: boolean;
}

/**
 * Awareness queue for handling followup requests
 * Only enabled when personality trait 'attentive' > 60
 */
export class AwarenessQueue {
  private queues = new Map<string, QueueState>();
  private readonly DEBOUNCE_MS = 500; // Wait 500ms before processing queue

  /**
   * Check if conversation is busy
   */
  isBusy(conversationId: string): boolean {
    const queue = this.queues.get(conversationId);
    return queue?.busy ?? false;
  }

  /**
   * Mark conversation as busy
   */
  markBusy(conversationId: string): void {
    const queue = this.getOrCreateQueue(conversationId);
    queue.busy = true;
  }

  /**
   * Mark conversation as idle
   */
  markIdle(conversationId: string): void {
    const queue = this.queues.get(conversationId);
    if (queue) {
      queue.busy = false;
      // Schedule drain if there are items
      if (queue.items.length > 0 && !queue.draining) {
        this.scheduleDrain(conversationId);
      }
    }
  }

  /**
   * Enqueue a followup run
   */
  enqueue(conversationId: string, followup: FollowupRun): void {
    const queue = this.getOrCreateQueue(conversationId);
    queue.items.push(followup);
    queue.lastEnqueuedAt = Date.now();
    
    // Schedule drain if not already draining
    if (!queue.draining) {
      this.scheduleDrain(conversationId);
    }
  }

  /**
   * Get or create queue for conversation
   */
  private getOrCreateQueue(conversationId: string): QueueState {
    let queue = this.queues.get(conversationId);
    if (!queue) {
      queue = {
        items: [],
        draining: false,
        lastEnqueuedAt: 0,
        busy: false,
      };
      this.queues.set(conversationId, queue);
    }
    return queue;
  }

  /**
   * Schedule queue drain
   */
  private scheduleDrain(conversationId: string): void {
    const queue = this.queues.get(conversationId);
    if (!queue || queue.draining) {
      return;
    }

    queue.draining = true;
    
    // Use setTimeout to debounce and allow async processing
    setTimeout(async () => {
      await this.drain(conversationId);
    }, this.DEBOUNCE_MS);
  }

  /**
   * Drain queue and process followup runs
   */
  private async drain(conversationId: string): Promise<void> {
    const queue = this.queues.get(conversationId);
    if (!queue) {
      return;
    }

    const initialItemCount = queue.items.length;
    let itemsProcessed = 0;

    try {
      while (queue.items.length > 0) {
        // Wait for debounce period if items were recently added
        const timeSinceLastEnqueue = Date.now() - queue.lastEnqueuedAt;
        if (timeSinceLastEnqueue < this.DEBOUNCE_MS) {
          await new Promise(resolve => setTimeout(resolve, this.DEBOUNCE_MS - timeSinceLastEnqueue));
        }

        const followup = queue.items.shift();
        if (!followup) {
          break;
        }

        // Process followup (this will be handled by the runtime)
        // The runtime should check the queue and process items
        // For now, we just mark as processed
        queue.lastEnqueuedAt = Date.now();
        itemsProcessed++;
      }
      
      // Record queue drain if items were processed
      if (itemsProcessed > 0) {
        // Import activity recorder dynamically to avoid circular dependency
        const { activityRecorder } = await import("@server/world/activity/index.js");
        // Use default agentId since this is the zuckerman agent's queue
        activityRecorder.recordAwarenessQueueDrained(
          "zuckerman",
          conversationId,
          itemsProcessed,
        ).catch((err: unknown) => {
          console.warn(`[AwarenessQueue] Failed to record drain:`, err);
        });
      }
    } catch (err) {
      console.error(`[AwarenessQueue] Drain failed for ${conversationId}:`, err);
    } finally {
      queue.draining = false;
      
      // Clean up empty queues
      if (queue.items.length === 0 && !queue.busy) {
        this.queues.delete(conversationId);
      }
    }
  }

  /**
   * Get queue depth for a conversation
   */
  getQueueDepth(conversationId: string): number {
    const queue = this.queues.get(conversationId);
    return queue?.items.length ?? 0;
  }

  /**
   * Get next item from queue without removing it
   */
  peekNext(conversationId: string): FollowupRun | undefined {
    const queue = this.queues.get(conversationId);
    return queue?.items[0];
  }

  /**
   * Clear queue for a conversation
   */
  clear(conversationId: string): void {
    const queue = this.queues.get(conversationId);
    if (queue) {
      queue.items = [];
      queue.draining = false;
      if (!queue.busy) {
        this.queues.delete(conversationId);
      }
    }
  }
}

// Singleton instance
export const awarenessQueue = new AwarenessQueue();
