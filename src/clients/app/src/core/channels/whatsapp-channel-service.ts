import type { GatewayClient } from "../gateway/client";
import type { WhatsAppConfig, ChannelConnectionState, ChannelStatus } from "./types";

/**
 * WhatsApp Channel Service - handles WhatsApp channel connection and configuration
 */
export class WhatsAppChannelService {
  private eventListeners: {
    status?: (status: {
      status: "connected" | "connecting" | "disconnected" | "waiting_for_scan";
      qr?: string | null;
    }) => void;
    error?: (error: string) => void;
  } = {};

  constructor(private client: GatewayClient) {
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for WhatsApp-specific events
   */
  private setupEventListeners(): void {
    const handleStatusEvent = (e: CustomEvent<{
      status: "connected" | "connecting" | "disconnected" | "waiting_for_scan";
      qr?: string | null;
      channelId: string;
    }>) => {
      if (e.detail.channelId === "whatsapp") {
        this.eventListeners.status?.({
          status: e.detail.status,
          qr: e.detail.qr ?? null,
        });
      }
    };

    window.addEventListener("whatsapp-status", handleStatusEvent as EventListener);

    // Store cleanup function
    this.cleanup = () => {
      window.removeEventListener("whatsapp-status", handleStatusEvent as EventListener);
    };
  }

  private cleanup?: () => void;

  /**
   * Register event listeners
   */
  on<K extends keyof { status: (status: { status: "connected" | "connecting" | "disconnected" | "waiting_for_scan"; qr?: string | null }) => void; error: (error: string) => void }>(
    event: K,
    handler: { status: (status: { status: "connected" | "connecting" | "disconnected" | "waiting_for_scan"; qr?: string | null }) => void; error: (error: string) => void }[K]
  ): void {
    this.eventListeners[event] = handler;
  }

  /**
   * Remove event listeners
   */
  off(event: keyof typeof this.eventListeners): void {
    delete this.eventListeners[event];
  }

  /**
   * Cleanup all listeners
   */
  destroy(): void {
    this.cleanup?.();
    this.eventListeners = {};
  }

  /**
   * Load WhatsApp configuration from gateway
   */
  async loadConfig(): Promise<WhatsAppConfig> {
    const configResponse = await this.client.request("config.get", {}) as {
      ok: boolean;
      result?: { config?: { channels?: { whatsapp?: WhatsAppConfig } } };
    };

    if (!configResponse.ok || !configResponse.result?.config?.channels?.whatsapp) {
      return {
        dmPolicy: "pairing",
        allowFrom: [],
      };
    }

    return {
      dmPolicy: configResponse.result.config.channels.whatsapp.dmPolicy || "pairing",
      allowFrom: configResponse.result.config.channels.whatsapp.allowFrom || [],
    };
  }

  /**
   * Save WhatsApp configuration
   */
  async saveConfig(config: WhatsAppConfig, immediate = false): Promise<void> {
    return new Promise((resolve, reject) => {
      const performSave = async () => {
        try {
          const configResponse = await this.client.request("config.update", {
            updates: {
              channels: {
                whatsapp: config,
              },
            },
          }) as { ok: boolean; error?: { message: string } };

          if (!configResponse.ok) {
            throw new Error(configResponse.error?.message || "Failed to update config");
          }

          // Reload channels if connected to apply config changes
          const status = await this.getStatus();
          if (status?.connected) {
            await this.client.request("channels.reload", {});
          }

          resolve();
        } catch (err: any) {
          reject(err);
        }
      };

      if (immediate) {
        performSave();
      } else {
        // Debounce saves to prevent rapid-fire reloads
        setTimeout(performSave, 500);
      }
    });
  }

  /**
   * Get current connection status
   */
  async getStatus(): Promise<ChannelStatus | null> {
    const statusResponse = await this.client.request("channels.status", {}) as {
      ok: boolean;
      result?: { status?: ChannelStatus[] };
    };

    if (!statusResponse.ok || !statusResponse.result?.status) {
      return null;
    }

    return statusResponse.result.status.find((s) => s.id === "whatsapp") || null;
  }

  /**
   * Connect WhatsApp channel
   * Uses channels.login endpoint (same as CLI) with JSON format
   */
  async connect(config?: Partial<WhatsAppConfig>): Promise<void> {
    if (!this.client.isConnected()) {
      await this.client.connect();
    }

    // Load existing config or use provided/default
    const currentConfig = config ? { ...await this.loadConfig(), ...config } : await this.loadConfig();

    // Update config first (for dmPolicy and allowFrom)
    const configResponse = await this.client.request("config.update", {
      updates: {
        channels: {
          whatsapp: {
            enabled: true,
            dmPolicy: currentConfig.dmPolicy || "pairing",
            allowFrom: currentConfig.allowFrom || [],
          },
        },
      },
    }) as { ok: boolean; error?: { message: string } };

    if (!configResponse.ok) {
      const error = configResponse.error?.message || "Failed to update config";
      this.eventListeners.error?.(error);
      throw new Error(error);
    }

    // Use channels.login endpoint (same logic as CLI, always uses JSON mode)
    const loginResponse = await this.client.request("channels.login", {
      channelId: "whatsapp",
      json: true, // Explicitly request JSON format (like CLI --json flag)
    }) as {
      ok: boolean;
      result?: { event: string; success?: boolean; message?: string };
      error?: { message: string };
    };

    if (!loginResponse.ok) {
      const error = loginResponse.error?.message || "Failed to login WhatsApp";
      this.eventListeners.error?.(error);
      throw new Error(error);
    }

    // If already connected, notify immediately
    if (loginResponse.result?.event === "connected" && loginResponse.result.success) {
      this.eventListeners.status?.({
        status: "connected",
        qr: null,
      });
      return;
    }

    // Otherwise, status will be emitted via event listener (channel.whatsapp.status)
  }

  /**
   * Disconnect WhatsApp channel
   */
  async disconnect(): Promise<void> {
    const stopResponse = await this.client.request("channels.stop", {
      channelId: "whatsapp",
    }) as { ok: boolean; error?: { message: string } };

    if (!stopResponse.ok) {
      throw new Error(stopResponse.error?.message || "Failed to stop WhatsApp");
    }

    this.eventListeners.status?.({
      status: "disconnected",
      qr: null,
    });
  }
}
