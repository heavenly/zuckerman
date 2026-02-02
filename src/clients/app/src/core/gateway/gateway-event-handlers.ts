/**
 * Gateway event handlers for common events
 * Single Responsibility: Handle gateway events and dispatch to window
 */
export class GatewayEventHandlers {
  /**
   * Create standard event handlers for React state management
   */
  static createStateHandlers(handlers: {
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: Error) => void;
  }) {
    return {
      onConnect: handlers.onConnect,
      onDisconnect: handlers.onDisconnect,
      onError: handlers.onError,
      onEvent: (event: any) => {
        // Handle channel events (e.g., WhatsApp status)
        if (event.event === "channel.whatsapp.status" && event.payload) {
          const payload = event.payload as {
            status: "connected" | "connecting" | "disconnected" | "waiting_for_scan";
            qr?: string | null;
            channelId: string;
          };
          window.dispatchEvent(new CustomEvent("whatsapp-status", { detail: payload }));
        } else if (event.event === "channel.telegram.status" && event.payload) {
          const payload = event.payload as {
            status: "connected" | "connecting" | "disconnected";
            channelId: string;
          };
          console.log("[GatewayEventHandlers] Dispatching telegram-status event:", payload.status);
          window.dispatchEvent(new CustomEvent("telegram-status", { detail: payload }));
        } else if (event.event === "channel.discord.status" && event.payload) {
          const payload = event.payload as {
            status: "connected" | "connecting" | "disconnected";
            channelId: string;
          };
          console.log("[GatewayEventHandlers] Dispatching discord-status event:", payload.status);
          window.dispatchEvent(new CustomEvent("discord-status", { detail: payload }));
        } else if (event.event === "channel.signal.status" && event.payload) {
          const payload = event.payload as {
            status: "connected" | "connecting" | "disconnected";
            channelId: string;
          };
          console.log("[GatewayEventHandlers] Dispatching signal-status event:", payload.status);
          window.dispatchEvent(new CustomEvent("signal-status", { detail: payload }));
        }
      },
    };
  }
}
