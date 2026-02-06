import type { Router, Route } from "./types.js";
import type { ChannelMessage } from "@server/world/communication/messengers/channels/types.js";
import { resolveAgentRoute, resolveAgentHomedir } from "./resolver.js";
import { loadConfig } from "@server/world/config/index.js";
import type { AgentRuntimeFactory } from "@server/world/runtime/agents/index.js";

export interface RoutedMessage {
  conversationId: string;
  agentId: string;
  conversationKey: string;
  homedir: string;
}

export class SimpleRouter implements Router {
  private routes: Route[] = [];
  private agentFactory: AgentRuntimeFactory;

  constructor(agentFactory: AgentRuntimeFactory) {
    this.agentFactory = agentFactory;
  }

  addRoute(route: Route): void {
    this.routes.push(route);
  }

  removeRoute(channelId: string): void {
    this.routes = this.routes.filter((r) => r.channelId !== channelId);
  }

  async route(message: ChannelMessage): Promise<string | null> {
    // Find matching route
    for (const route of this.routes) {
      if (route.channelId === message.channelId) {
        if (!route.condition || route.condition(message)) {
          return route.conversationId;
        }
      }
    }

    // Default: use main conversation for default agent
    const config = await loadConfig();
    const defaultAgent = config.agents?.list?.find((a) => a.default) || config.agents?.list?.[0];
    const agentId = defaultAgent?.id || "zuckerman";
    const runtime = await this.agentFactory.getRuntime(agentId);
    if (!runtime?.getOrCreateMainConversation) {
      throw new Error(`Agent "${agentId}" not found or does not support conversation management`);
    }
    const mainConversation = runtime.getOrCreateMainConversation();
    return mainConversation.id;
  }

  /**
   * Route a message to an agent using routing rules
   */
  async routeToAgent(message: ChannelMessage, options?: {
    accountId?: string;
    guildId?: string;
    teamId?: string;
  }): Promise<RoutedMessage> {
    const config = await loadConfig();
    
    // Determine peer type from message metadata
    const peer = message.metadata?.peerId ? {
      kind: (message.metadata?.peerKind as "dm" | "group" | "channel") || "dm",
      id: message.metadata.peerId as string,
    } : undefined;

    // Resolve agent route
    const route = resolveAgentRoute({
      config,
      channel: message.channelId as any,
      accountId: options?.accountId,
      peer,
      guildId: options?.guildId,
      teamId: options?.teamId,
    });

    // Get or create conversation for this route using runtime router
    const runtime = await this.agentFactory.getRuntime(route.agentId);
    if (!runtime?.getOrCreateConversationByKey) {
      throw new Error(`Agent "${route.agentId}" not found or does not support conversation routing`);
    }
    
    // Determine conversation type from peer kind (already determined above)
    const conversationType = peer?.kind === "group" ? "group" : peer?.kind === "channel" ? "channel" : "main";
    const conversation = runtime.getOrCreateConversationByKey(route.conversationKey, conversationType);
    
    // Resolve homedir directory
    const homedir = resolveAgentHomedir(config, route.agentId);

    return {
      conversationId: conversation.id,
      agentId: route.agentId,
      conversationKey: route.conversationKey,
      homedir,
    };
  }
}
