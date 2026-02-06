import type { GatewayRequestHandlers } from "../types.js";
import { ChannelRegistry } from "@server/world/communication/messengers/channels/index.js";
import { SimpleRouter } from "@server/world/communication/routing/index.js";
import { AgentRuntimeFactory } from "@server/world/runtime/agents/index.js";
import { loadConfig, saveConfig } from "@server/world/config/index.js";
import { initializeChannels } from "@server/world/communication/messengers/channels/factory.js";
import { WhatsAppChannel } from "@server/world/communication/messengers/channels/whatsapp.js";

export function createChannelHandlers(
  channelRegistry: ChannelRegistry,
  router: SimpleRouter,
  agentFactory: AgentRuntimeFactory,
  broadcastEvent?: (event: { type: "event"; event: string; payload?: unknown }) => void,
): Partial<GatewayRequestHandlers> {
  return {
    "channels.list": async ({ respond }) => {
      try {
        const channels = channelRegistry.list();
        respond(true, {
          channels: channels.map((ch) => ({
            id: ch.id,
            type: ch.type,
          })),
        });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to list channels",
        });
      }
    },

    "channels.status": async ({ respond }) => {
      try {
        const channels = channelRegistry.list();
        const status = channels.map((ch) => {
          const registryStatus = channelRegistry.getStatus(ch.id);
          return {
            id: ch.id,
            type: ch.type,
            status: registryStatus,
            connected: ch.isConnected(),
          };
        });
        respond(true, { status });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to get channel status",
        });
      }
    },

    "channels.start": async ({ respond, params }) => {
      try {
        const channelId = params?.channelId as string | undefined;
        if (!channelId) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: "Missing channelId",
          });
          return;
        }

        await channelRegistry.start(channelId);
        respond(true, { channelId, started: true });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to start channel",
        });
      }
    },

    "channels.stop": async ({ respond, params }) => {
      try {
        const channelId = params?.channelId as string | undefined;
        if (!channelId) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: "Missing channelId",
          });
          return;
        }

        await channelRegistry.stop(channelId);
        respond(true, { channelId, stopped: true });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to stop channel",
        });
      }
    },

    "channels.reload": async ({ respond }) => {
      try {
        // Reload config and reinitialize channels
        const config = await loadConfig();
        
        // Stop all existing channels
        await channelRegistry.stopAll();
        
        // Clear registry
        channelRegistry.clear();
        
        // Reinitialize channels from updated config
        const newChannels = await initializeChannels(
          config,
          router,
          agentFactory,
          broadcastEvent,
        );
        
        // Copy new channels to existing registry
        for (const channel of newChannels.list()) {
          const channelConfig = newChannels.getConfig(channel.id);
          if (channelConfig) {
            channelRegistry.register(channel, channelConfig);
          }
        }
        
        // Start enabled channels
        await channelRegistry.startAll();
        
        respond(true, { reloaded: true });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to reload channels",
        });
      }
    },

    "channels.login": async ({ respond, params }) => {
      try {
        const channelId = params?.channelId as string | undefined;
        const jsonMode = params?.json !== false; // Default to JSON mode (always true for app)
        
        if (!channelId) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: "Missing channelId",
          });
          return;
        }

        if (channelId !== "whatsapp") {
          respond(false, undefined, {
            code: "NOT_SUPPORTED",
            message: `Login for channel "${channelId}" is not yet supported`,
          });
          return;
        }

        const config = await loadConfig();

        // Ensure WhatsApp config exists
        if (!config.channels) {
          config.channels = {};
        }
        if (!config.channels.whatsapp) {
          config.channels.whatsapp = {
            enabled: false,
            dmPolicy: "pairing",
            allowFrom: [],
          };
        }

        // Temporarily enable for login
        const originalEnabled = config.channels.whatsapp.enabled;
        config.channels.whatsapp.enabled = true;

        // Create channel with callbacks that broadcast events (like factory does)
        const whatsappChannel = new WhatsAppChannel(
          config.channels.whatsapp,
          (status) => {
            // Broadcast status to all connected gateway clients
            if (broadcastEvent) {
              broadcastEvent({
                type: "event",
                event: "channel.whatsapp.status",
                payload: { ...status, channelId: "whatsapp", ts: Date.now() },
              });
            }
          },
        );

        // Stop existing channel if it exists (register will overwrite it)
        try {
          await channelRegistry.stop("whatsapp");
        } catch {
          // Channel doesn't exist, that's fine
        }

        // Register the channel in the registry first (before starting)
        channelRegistry.register(whatsappChannel, {
          id: "whatsapp",
          type: "whatsapp",
          enabled: true,
          config: config.channels.whatsapp as Record<string, unknown>,
        });

        // Start the channel (non-blocking - don't await to avoid blocking the handler)
        // QR code and connection status will be emitted via broadcastEvent
        whatsappChannel.start().then(async () => {
          // After start completes, check if connected (might have credentials)
          // Small delay to allow socket to initialize
          setTimeout(async () => {
            if (whatsappChannel.isConnected()) {
              if (config.channels && config.channels.whatsapp) {
                config.channels.whatsapp.enabled = true;
                await saveConfig(config);
              }
              // Connection status already broadcast via callback above
            }
          }, 500);
        }).catch((err) => {
          console.error("[Gateway] Failed to start WhatsApp channel:", err);
          // Broadcast error event if needed
          if (broadcastEvent) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            broadcastEvent({
              type: "event",
              event: "channel.whatsapp.connection",
              payload: { connected: false, channelId: "whatsapp", error: errorMessage, ts: Date.now() },
            });
          }
        });

        // Respond immediately - don't wait for start() to complete
        // QR code will be emitted via broadcastEvent (channel.whatsapp.qr)
        // Connection status will be emitted via broadcastEvent (channel.whatsapp.connection)
        respond(true, {
          event: "qr_pending",
          message: "QR code will be sent via channel.whatsapp.qr event",
        });
      } catch (err) {
        respond(false, undefined, {
          code: "ERROR",
          message: err instanceof Error ? err.message : "Failed to login channel",
        });
      }
    },
  };
}
