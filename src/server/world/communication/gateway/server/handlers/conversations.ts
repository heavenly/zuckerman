import type { GatewayRequestHandlers } from "../types.js";
import type { AgentRuntime } from "@server/world/runtime/agents/types.js";
import type { ConversationState, Conversation } from "@server/agents/zuckerman/conversations/types.js";
import type { AgentRuntimeFactory } from "@server/world/runtime/agents/index.js";
import { loadConfig } from "@server/world/config/index.js";

/**
 * Find conversation across all agents using runtime methods
 */
async function findConversationAcrossAgents(
  agentFactory: AgentRuntimeFactory,
  conversationId: string
): Promise<{ runtime: AgentRuntime; state: ConversationState } | null> {
  const config = await loadConfig();
  const agentIds = config.agents?.list?.map((a) => a.id) || ["zuckerman"];

  for (const agentId of agentIds) {
    const runtime = await agentFactory.getRuntime(agentId);
    if (runtime && runtime.getConversation) {
      const state = runtime.getConversation(conversationId);
      if (state) {
        return { runtime, state };
      }
    }
  }

  return null;
}

/**
 * List all conversations across all agents using runtime methods
 */
async function listAllConversations(agentFactory: AgentRuntimeFactory): Promise<Conversation[]> {
  const config = await loadConfig();
  const agentIds = config.agents?.list?.map((a) => a.id) || ["zuckerman"];
  const allConversations: Conversation[] = [];

  for (const agentId of agentIds) {
    const runtime = await agentFactory.getRuntime(agentId);
    if (runtime && runtime.listConversations) {
      const conversations = runtime.listConversations();
      allConversations.push(...conversations);
    }
  }

  return allConversations;
}

export function createConversationHandlers(agentFactory: AgentRuntimeFactory): Partial<GatewayRequestHandlers> {
  return {
    "conversations.create": async ({ respond, params }) => {
      const label = params?.label as string | undefined;
      const type = (params?.type as string | undefined) || "main";
      const agentId = (params?.agentId as string | undefined) || "zuckerman";

      const runtime = await agentFactory.getRuntime(agentId);
      if (!runtime) {
        respond(false, undefined, {
          code: "AGENT_NOT_FOUND",
          message: `Agent "${agentId}" not found`,
        });
        return;
      }

      const conversation = runtime.createConversation?.(
        label || `conversation-${Date.now()}`,
        type as "main" | "group" | "channel",
        agentId,
      );
      
      if (!conversation) {
        respond(false, undefined, {
          code: "AGENT_ERROR",
          message: `Agent "${agentId}" does not support conversation creation`,
        });
        return;
      }

      respond(true, { conversation });
    },

    "conversations.list": async ({ respond }) => {
      const conversations = await listAllConversations(agentFactory);
      respond(true, { conversations });
    },

    "conversations.get": async ({ respond, params }) => {
      const id = params?.id as string | undefined;
      if (!id) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing conversation id",
        });
        return;
      }

      const result = await findConversationAcrossAgents(agentFactory, id);
      if (!result) {
        respond(false, undefined, {
          code: "NOT_FOUND",
          message: `Conversation ${id} not found`,
        });
        return;
      }

      respond(true, { conversation: result.state });
    },

    "conversations.delete": async ({ respond, params }) => {
      const id = params?.id as string | undefined;
      if (!id) {
        respond(false, undefined, {
          code: "INVALID_REQUEST",
          message: "Missing conversation id",
        });
        return;
      }

      const result = await findConversationAcrossAgents(agentFactory, id);
      if (!result) {
        respond(false, undefined, {
          code: "NOT_FOUND",
          message: `Conversation ${id} not found`,
        });
        return;
      }

      const deleted = result.runtime.deleteConversation?.(id) ?? false;
      if (!deleted) {
        respond(false, undefined, {
          code: "NOT_FOUND",
          message: `Conversation ${id} not found`,
        });
        return;
      }

      respond(true, { deleted: true });
    },
  };
}
