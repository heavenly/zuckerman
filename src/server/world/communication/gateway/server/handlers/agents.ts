import type { GatewayRequestHandlers } from "../types.js";
import type { AgentRuntime } from "@server/world/runtime/agents/types.js";
import { AgentRuntimeFactory } from "@server/world/runtime/agents/index.js";
import { agentDiscovery } from "@server/agents/discovery.js";
import { loadConfig } from "@server/world/config/index.js";
import { resolveSecurityContext } from "@server/world/execution/security/context/index.js";
import { resolveAgentHomedir } from "@server/world/communication/routing/resolver.js";
import type { StreamEvent } from "@server/world/runtime/agents/types.js";
import { sendEvent } from "../connection.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createAgentHandlers(
  agentFactory: AgentRuntimeFactory,
): Partial<GatewayRequestHandlers> {
  return {
    "agents.list": async ({ respond }) => {
      try {
        const agents = await agentFactory.listAgents();
        respond(true, { agents });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to list agents",
        });
      }
    },

    "agents.discover": async ({ respond, params }) => {
      const agentId = params?.agentId as string | undefined;
      
      try {
        if (agentId) {
          // Get metadata for specific agent
          const metadata = agentDiscovery.getMetadata(agentId);
          if (!metadata) {
            respond(false, undefined, {
              code: "AGENT_NOT_FOUND",
              message: `Agent "${agentId}" not found in discovery service`,
            });
            return;
          }
          respond(true, { agent: metadata });
        } else {
          // Get all agent metadata
          const allMetadata = agentDiscovery.getAllMetadata();
          respond(true, { agents: allMetadata });
        }
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to discover agents",
        });
      }
    },

    "agent.run": async ({ respond, params, client }) => {
      const conversationId = params?.conversationId as string | undefined;
      const message = params?.message as string | undefined;
      const config = await loadConfig();
      
      // Resolve agent ID - check params first, then config
      let agentId = params?.agentId as string | undefined;
      if (!agentId) {
        // Get from agents.list default
        const agents = config.agents?.list || [];
        const defaultAgent = agents.find(a => a.default) || agents[0];
        agentId = defaultAgent?.id || "zuckerman";
      }
      
      const thinkingLevel = params?.thinkingLevel as string | undefined;
      const model = params?.model as { id: string; name?: string } | undefined;
      const temperature = params?.temperature as number | undefined;

      if (!conversationId) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing conversationId",
        });
        return;
      }

      if (!message) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing message",
        });
        return;
      }

      try {
        // Get agent runtime (factory handles all retry logic internally)
        let runtime: AgentRuntime | null = null;
        let loadError: string | undefined;
        
        try {
          runtime = await agentFactory.getRuntime(agentId);
        } catch (err) {
          loadError = err instanceof Error ? err.message : String(err);
        }
        
        if (!runtime) {
          // Check if agent is listed but runtime failed to load
          const listedAgents = await agentFactory.listAgents();
          const isListed = listedAgents.includes(agentId);
          
          // Get stored error if loadError is not set
          if (!loadError && agentFactory.getLoadError) {
            loadError = agentFactory.getLoadError(agentId);
          }
          
          const errorMessage = loadError || "Failed to load runtime (check gateway logs for details)";
          
          respond(false, undefined, {
            code: "AGENT_NOT_FOUND",
            message: isListed 
              ? `Agent "${agentId}" is listed but failed to load. Error: ${errorMessage}`
              : `Agent "${agentId}" not found. Available agents: ${listedAgents.join(", ") || "none"}`,
          });
          return;
        }
        
        // Get or create conversation using runtime methods
        let conversation = runtime.getConversation?.(conversationId);
        let actualConversationId = conversationId;
        if (!conversation) {
          const newConversation = runtime.createConversation?.(`conversation-${conversationId}`, "main", agentId);
          if (newConversation) {
            conversation = runtime.getConversation?.(newConversation.id);
            actualConversationId = newConversation.id; // Use the actual created conversation ID
          }
        }

        if (!conversation) {
          respond(false, undefined, {
            code: "CONVERSATION_ERROR",
            message: "Failed to get or create conversation",
          });
          return;
        }

        // Resolve homedir directory for this agent
        const homedir = resolveAgentHomedir(config, agentId);
        const securityContext = await resolveSecurityContext(
          config.security,
          actualConversationId,
          conversation.conversation.type,
          agentId,
          homedir,
        );

        // Note: Runtime now handles persisting user message internally

        // Create streaming callback to emit events
        const streamCallback = async (event: StreamEvent) => {
          // Emit event to the client
          try {
            // Emit standard stream event
            sendEvent(client.socket, {
              type: "event",
              event: `agent.stream.${event.type}`,
              payload: {
                ...event.data,
                conversationId: actualConversationId,
              },
            });
          } catch (err) {
            console.error(`[AgentHandler] Error sending stream event:`, err);
          }
        };

        // Pass security context to runtime (use actualConversationId)
        const result = await runtime.run({
          conversationId: actualConversationId,
          message,
          thinkingLevel: thinkingLevel as any,
          temperature,
          securityContext,
          stream: streamCallback,
        });

        // Note: Runtime now handles persisting assistant response and all messages

        respond(true, {
          runId: result.runId,
          response: result.response,
          tokensUsed: result.tokensUsed,
          toolsUsed: result.toolsUsed,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Agent execution failed";
        
        // Check if it's an LLM provider error
        if (errorMessage.includes("API key") || errorMessage.includes("No LLM provider")) {
          respond(false, undefined, {
            code: "LLM_CONFIG_ERROR",
            message: `${errorMessage}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.`,
          });
        } else {
          respond(false, undefined, {
            code: "AGENT_ERROR",
            message: errorMessage,
          });
        }
      }
    },

    "agent.prompts": async ({ respond, params }) => {
      const agentId = (params?.agentId as string | undefined) || null;

      if (!agentId) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing agentId",
        });
        return;
      }

      try {
        // Clear runtime cache to ensure we load fresh prompt files
        agentFactory.clearCache(agentId);
        
        const runtime = await agentFactory.getRuntime(agentId);
        if (!runtime?.loadPrompts) {
          respond(false, undefined, {
            code: "AGENT_NOT_FOUND",
            message: `Agent "${agentId}" not found or doesn't support prompt loading`,
          });
          return;
        }

        // Clear runtime cache if available (public API)
        runtime.clearCache?.();

        // Load prompts via public API
        const prompts = await runtime.loadPrompts();
        const promptsData = prompts as {
          files?: Map<string, string>;
        };

        // Convert Map to object with filename as key
        const files: Record<string, string> = {};
        if (promptsData.files) {
          for (const [fileName, content] of promptsData.files.entries()) {
            files[fileName] = content;
          }
        }

        // Return all files dynamically
        respond(true, {
          agentId,
          files,
        });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to load prompts",
        });
      }
    },

    "agent.savePrompt": async ({ respond, params }) => {
      const agentId = params?.agentId as string | undefined;
      const fileName = params?.fileName as string | undefined;
      const content = params?.content as string | undefined;

      if (!agentId) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing agentId",
        });
        return;
      }

      if (!fileName) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing fileName",
        });
        return;
      }

      if (content === undefined) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing content",
        });
        return;
      }

      try {
        // Resolve agent directory from discovery service
        const metadata = agentDiscovery.getMetadata(agentId);
        if (!metadata) {
          respond(false, undefined, {
            code: "AGENT_NOT_FOUND",
            message: `Agent "${agentId}" not found in discovery service`,
          });
          return;
        }
        const agentDir = metadata.agentDir;
        const identityDir = join(agentDir, "core", "identity");
        
        // Ensure fileName ends with .md
        const fileWithExt = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
        const filePath = join(identityDir, fileWithExt);

        // Write file
        await writeFile(filePath, content, "utf-8");

        // Clear caches to ensure fresh load
        agentFactory.clearCache(agentId);
        const runtime = await agentFactory.getRuntime(agentId);
        // Clear runtime cache via public API if available
        runtime?.clearCache?.();

        respond(true, {
          agentId,
          fileName: fileWithExt,
          saved: true,
        });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to save prompt file",
        });
      }
    },

    "agent.reload": async ({ respond, params }) => {
      const agentId = params?.agentId as string | undefined;
      
      try {
        if (agentId) {
          // Clear cache for specific agent
          agentFactory.clearCache(agentId);
          respond(true, { 
            reloaded: true, 
            agentId,
            message: `Cache cleared for agent "${agentId}". Next use will reload from disk.` 
          });
        } else {
          // Clear cache for all agents
          agentFactory.clearCache();
          respond(true, { 
            reloaded: true, 
            message: "Cache cleared for all agents. Next use will reload from disk." 
          });
        }
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to reload agent cache",
        });
      }
    },
  };
}
