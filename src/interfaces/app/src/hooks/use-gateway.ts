import { useState, useEffect, useRef, useCallback } from "react";
import { GatewayClient } from "../core/gateway/client";
import { setGatewaySettings } from "../core/storage/settings-storage";
import { GatewayClientFactory } from "../core/gateway/gateway-client-factory";
import { GatewayEventHandlers } from "../core/gateway/gateway-event-handlers";
import { gatewayService } from "../core/gateway/gateway-service";

export type ConnectionStatus = "connected" | "disconnected" | "connecting";

export interface GatewayStatus {
  running: boolean;
  address?: string;
  error?: string;
}

export interface UseGatewayReturn {
  // Connection state
  gatewayClient: GatewayClient | null;
  connectionStatus: ConnectionStatus;
  
  // Connection actions
  connect: () => Promise<void>;
  disconnect: () => void;
  updateConfig: (host: string, port: number) => Promise<void>;
  
  // Server management
  serverStatus: GatewayStatus | null;
  isServerLoading: boolean;
  isServerStarting: boolean;
  isServerStopping: boolean;
  startServer: (host: string, port: number) => Promise<boolean>;
  stopServer: (host: string, port: number) => Promise<boolean>;
  checkServerStatus: (host: string, port: number) => Promise<void>;
  startPolling: (host: string, port: number, interval?: number) => void;
  stopPolling: () => void;
}

const EXPLICITLY_STOPPED_KEY = "zuckerman:gateway:explicitly-stopped";

/**
 * Consolidated hook for all gateway functionality:
 * - Client connection management
 * - Server lifecycle management
 * - Auto-initialization on mount
 */
export function useGateway(): UseGatewayReturn {
  // Connection state
  const [gatewayClient, setGatewayClient] = useState<GatewayClient | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const connectingRef = useRef(false);

  // Server management state
  const [serverStatus, setServerStatus] = useState<GatewayStatus | null>(null);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const [isServerStarting, setIsServerStarting] = useState(false);
  const [isServerStopping, setIsServerStopping] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to check if gateway was explicitly stopped (persisted across hook instances)
  const isExplicitlyStopped = useCallback((): boolean => {
    return localStorage.getItem(EXPLICITLY_STOPPED_KEY) === "true";
  }, []);

  // Helper to set explicitly stopped state
  const setExplicitlyStopped = useCallback((stopped: boolean): void => {
    if (stopped) {
      localStorage.setItem(EXPLICITLY_STOPPED_KEY, "true");
    } else {
      localStorage.removeItem(EXPLICITLY_STOPPED_KEY);
    }
  }, []);

  // Initialize gateway client from settings
  useEffect(() => {
    const eventHandlers = GatewayEventHandlers.createStateHandlers({
      onConnect: () => {
        console.log("[Gateway] Connection established");
        setConnectionStatus("connected");
      },
      onDisconnect: () => {
        console.log("[Gateway] Connection lost");
        setConnectionStatus("disconnected");
      },
      onError: (error) => {
        console.error("[Gateway] Error:", error);
      },
    });

    const client = GatewayClientFactory.createWithStateHandlers(eventHandlers);
    setGatewayClient(client);
    setConnectionStatus("disconnected");

    return () => {
      client.disconnect();
    };
  }, []);

  // Auto-initialize and start gateway server on mount (only if autoStart is enabled and not explicitly stopped)
  useEffect(() => {
    if (!window.electronAPI) {
      console.warn("[Gateway] electronAPI not available, skipping gateway start");
      return;
    }

    // Check autoStart setting
    const settings = localStorage.getItem("zuckerman:settings");
    let autoStart = true; // Default to true for backward compatibility
    if (settings) {
      try {
        const parsed = JSON.parse(settings);
        autoStart = parsed.gateway?.autoStart !== false;
      } catch {
        // Use default
      }
    }

    gatewayService.initialize(window.electronAPI);
    
    // Only auto-start if enabled and not explicitly stopped
    if (autoStart && !isExplicitlyStopped()) {
      gatewayService.ensureRunning().then((result) => {
        if (result.success) {
          if (result.alreadyRunning) {
            console.log("[Gateway] Gateway was already running");
          } else {
            console.log("[Gateway] Gateway started successfully");
          }
        } else {
          const errorMsg = result.error || "Failed to start gateway";
          console.warn("[Gateway] Gateway startup issue (non-critical):", errorMsg);
        }
      }).catch((err) => {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.warn("[Gateway] Gateway startup error (non-critical):", errorMessage);
      });
    } else {
      console.log("[Gateway] Skipping auto-start (autoStart disabled or explicitly stopped)");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connection actions
  const connect = useCallback(async () => {
    if (!gatewayClient || gatewayClient.isConnected() || connectingRef.current) {
      return;
    }

    connectingRef.current = true;
    setConnectionStatus("connecting");
    try {
      await gatewayClient.connect();
      if (gatewayClient.isConnected()) {
        setConnectionStatus("connected");
      }
    } catch (error) {
      console.error("[Gateway] Failed to connect:", error);
      setConnectionStatus("disconnected");
    } finally {
      connectingRef.current = false;
    }
  }, [gatewayClient]);

  // Auto-reconnect on disconnect (only if gateway wasn't explicitly stopped)
  useEffect(() => {
    if (!gatewayClient) return;

    const checkInterval = setInterval(() => {
      const isConnected = gatewayClient.isConnected();
      const shouldReconnect = !isConnected && 
                              connectionStatus === "disconnected" && 
                              !connectingRef.current &&
                              !isExplicitlyStopped() &&
                              serverStatus?.running;

      if (shouldReconnect) {
        console.log("[Gateway] Connection lost, attempting to reconnect...");
        connect();
      }
    }, 2000);

    return () => clearInterval(checkInterval);
  }, [gatewayClient, connectionStatus, connect, serverStatus, isExplicitlyStopped]);

  const disconnect = useCallback(() => {
    if (gatewayClient) {
      gatewayClient.disconnect();
      setConnectionStatus("disconnected");
    }
  }, [gatewayClient]);

  const updateConfig = useCallback(async (host: string, port: number) => {
    setGatewaySettings({ host, port });

    if (gatewayClient) {
      gatewayClient.disconnect();
    }

    const eventHandlers = GatewayEventHandlers.createStateHandlers({
      onConnect: () => {
        setConnectionStatus("connected");
      },
      onDisconnect: () => {
        setConnectionStatus("disconnected");
      },
      onError: (error) => {
        console.error("Gateway error:", error);
      },
    });

    const newClient = GatewayClientFactory.create({
      host,
      port,
      ...eventHandlers,
    });

    setGatewayClient(newClient);
    setConnectionStatus("connecting");
    try {
      await newClient.connect();
    } catch (error) {
      console.error("Failed to connect:", error);
      setConnectionStatus("disconnected");
    }
  }, [gatewayClient]);

  // Server management actions
  const checkServerStatus = useCallback(async (host: string, port: number) => {
    if (!window.electronAPI) {
      setServerStatus({ running: false, error: "Electron API not available" });
      return;
    }

    setIsServerLoading(true);
    try {
      const result = await window.electronAPI.gatewayStatus(host, port);
      setServerStatus(result);
    } catch (error) {
      setServerStatus({
        running: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsServerLoading(false);
    }
  }, []);

  const startServer = useCallback(async (host: string, port: number): Promise<boolean> => {
    if (!window.electronAPI) {
      throw new Error("Electron API not available");
    }

    setIsServerStarting(true);
    setExplicitlyStopped(false); // Clear the explicitly stopped flag when starting
    try {
      const result = await window.electronAPI.gatewayStart(host, port);
      if (result.success) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await checkServerStatus(host, port);
        return true;
      } else {
        setServerStatus({
          running: false,
          error: result.error || "Failed to start gateway",
        });
        return false;
      }
    } catch (error) {
      setServerStatus({
        running: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    } finally {
      setIsServerStarting(false);
    }
  }, [checkServerStatus, setExplicitlyStopped]);

  const stopServer = useCallback(async (host: string, port: number): Promise<boolean> => {
    if (!window.electronAPI) {
      throw new Error("Electron API not available");
    }

    setIsServerStopping(true);
    setExplicitlyStopped(true); // Mark as explicitly stopped to prevent auto-reconnect
    try {
      const result = await window.electronAPI.gatewayStop(host, port);
      if (result.success) {
        // Disconnect the client when stopping the server
        if (gatewayClient) {
          gatewayClient.disconnect();
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        await checkServerStatus(host, port);
        return true;
      } else {
        setServerStatus({
          running: serverStatus?.running || false,
          error: result.error || "Failed to stop gateway",
        });
        return false;
      }
    } catch (error) {
      setServerStatus({
        running: serverStatus?.running || false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    } finally {
      setIsServerStopping(false);
    }
  }, [checkServerStatus, serverStatus, gatewayClient, setExplicitlyStopped]);

  const startPolling = useCallback((host: string, port: number, interval: number = 5000) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(() => {
      checkServerStatus(host, port);
    }, interval);
  }, [checkServerStatus]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    gatewayClient,
    connectionStatus,
    connect,
    disconnect,
    updateConfig,
    serverStatus,
    isServerLoading,
    isServerStarting,
    isServerStopping,
    startServer,
    stopServer,
    checkServerStatus,
    startPolling,
    stopPolling,
  };
}
