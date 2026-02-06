import type { AgentRuntime } from "./types.js";
import { loadConfig } from "@server/world/config/index.js";
import { getAgentRuntimeClass, getRegisteredAgentIds } from "@server/agents/index.js";

/**
 * Options for AgentRuntimeFactory constructor
 */
export interface AgentRuntimeFactoryOptions {
  // No options needed - agents are imported via registry
}

/**
 * Check if a class is a valid AgentRuntime implementation
 */
function isValidRuntimeClass(cls: unknown): cls is new () => AgentRuntime {
  if (typeof cls !== "function") {
    return false;
  }

  const prototype = cls.prototype;
  if (!prototype) {
    return false;
  }

  // Must have run method (agentId is a class property, not prototype property)
  return typeof prototype.run === "function";
}

/**
 * Agent runtime factory - creates and manages agent runtime instances
 * Uses agent registry for discovery (no file system detection)
 */
export class AgentRuntimeFactory {
  private runtimes = new Map<string, AgentRuntime>();
  private loadErrors = new Map<string, string>();

  constructor(_options?: AgentRuntimeFactoryOptions) {
    // No initialization needed - agents are imported via registry
  }


  /**
   * Get or create an agent runtime
   * Handles all retry logic internally - callers should just call this once
   */
  async getRuntime(agentId: string): Promise<AgentRuntime | null> {
    // Check cache first
    const cached = this.runtimes.get(agentId);
    if (cached) {
      return cached;
    }

    // Clear any previous error for this agent
    this.loadErrors.delete(agentId);

    // Try loading runtime
    try {
      const runtime = await this.createRuntime(agentId);
      if (runtime) {
        this.runtimes.set(agentId, runtime);
        return runtime;
      }
      
      // If runtime is null, check if there's a stored error from a previous attempt
      const storedError = this.loadErrors.get(agentId);
      if (storedError) {
        throw new Error(storedError);
      }
      
      return null;
    } catch (err) {
      // First attempt failed - try clearing cache and retrying once
      const errorDetails = err instanceof Error ? err.message : String(err);
      console.warn(`[AgentFactory] Runtime for "${agentId}" failed to load, clearing cache and retrying...`);
      
      // Clear cache and retry
      this.clearCache(agentId);
      this.loadErrors.delete(agentId);
      
      try {
        const retryRuntime = await this.createRuntime(agentId);
        if (retryRuntime) {
          this.runtimes.set(agentId, retryRuntime);
          return retryRuntime;
        }
        
        // Retry also returned null
        const retryError = this.loadErrors.get(agentId) || errorDetails;
        this.loadErrors.set(agentId, retryError);
        return null;
      } catch (retryErr) {
        // Retry also failed
        const retryError = retryErr instanceof Error ? retryErr.message : String(retryErr);
        this.loadErrors.set(agentId, retryError);
        throw retryErr;
      }
    }
  }

  /**
   * Create a new runtime instance for an agent from registry
   */
  private async createRuntime(agentId: string): Promise<AgentRuntime | null> {
    try {
      // Get runtime class from registry
      const RuntimeClass = getAgentRuntimeClass(agentId);

      if (!RuntimeClass) {
        const registeredAgents = getRegisteredAgentIds().join(", ");
        const errorMsg = `Agent "${agentId}" is not registered. Registered agents: ${registeredAgents || "none"}`;
        console.error(`[AgentFactory] ${errorMsg}`);
        this.loadErrors.set(agentId, errorMsg);
        return null;
      }

      if (!isValidRuntimeClass(RuntimeClass)) {
        const errorMsg = `Agent "${agentId}" runtime class does not implement AgentRuntime interface`;
        console.error(`[AgentFactory] ${errorMsg}`);
        this.loadErrors.set(agentId, errorMsg);
        return null;
      }

      // Create runtime instance (AgentService creates ConversationManager internally)
      const runtime = new RuntimeClass();
      
      // Initialize the runtime if it has an initialize method
      if (runtime.initialize) {
        await runtime.initialize();
      }
      
      return runtime;
    } catch (err) {
      const errorDetails = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      
      const fullError = `Error: ${errorDetails}${stack ? `\nStack:\n${stack}` : ""}`;
      
      console.error(`[AgentFactory] Failed to load runtime for agent "${agentId}":`);
      console.error(`[AgentFactory]   ${fullError}`);
      
      // Store error for retrieval
      this.loadErrors.set(agentId, errorDetails);
      
      // Re-throw the error so it can be caught and reported to the client
      throw new Error(fullError);
    }
  }

  /**
   * Clear runtime cache (for hot reload)
   */
  clearCache(agentId?: string): void {
    if (agentId) {
      const runtime = this.runtimes.get(agentId);
      if (runtime?.clearCache) {
        runtime.clearCache();
      }
      this.runtimes.delete(agentId);
      this.loadErrors.delete(agentId);
    } else {
      for (const runtime of this.runtimes.values()) {
        if (runtime.clearCache) {
          runtime.clearCache();
        }
      }
      this.runtimes.clear();
      this.loadErrors.clear();
    }
  }

  /**
   * Get the last load error for an agent (if any)
   */
  getLoadError(agentId: string): string | undefined {
    return this.loadErrors.get(agentId);
  }

  /**
   * List available agent IDs
   * First checks config.json, then falls back to registry
   */
  async listAgents(): Promise<string[]> {
    // First, try to get agents from config.json
    try {
      const config = await loadConfig();
      if (config.agents?.list && config.agents.list.length > 0) {
        const configAgents = config.agents.list.map(a => a.id);
        // Verify these agents are registered
        const registeredAgents = getRegisteredAgentIds();
        const validAgents = configAgents.filter(id => registeredAgents.includes(id));
        if (validAgents.length > 0) {
          return validAgents;
        }
      }
    } catch (err) {
      console.warn("Failed to load agents from config:", err);
    }

    // Fallback to registry
    return getRegisteredAgentIds();
  }
}
