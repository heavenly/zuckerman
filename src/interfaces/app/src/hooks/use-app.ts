import { useEffect, useCallback, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useGateway } from "./use-gateway";
import { useAgents } from "./use-agents";
import { useChat } from "./use-chat";
import { removeStorageItem, getStorageItem, setStorageItem } from "../core/storage/local-storage";
import type { OnboardingState } from "../features/onboarding/onboarding-flow";
import type { AppState } from "../types/app-state";

export interface UseAppReturn extends AppState {
  // Actions
  setCurrentAgentId: (agentId: string | null) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
  createSession: (type: "main" | "group" | "channel", agentId: string, label?: string) => Promise<void>;
  connect: () => Promise<void>;
  updateGatewayConfig: (host: string, port: number) => Promise<void>;

  // Chat feature
  activeSessionIds: Set<string>;
  addToActiveSessions: (sessionId: string) => void;
  removeFromActiveSessions: (sessionId: string) => void;
  messages: import("../types/message").Message[];
  isSending: boolean;
  sendMessage: (message: string) => Promise<void>;
  loadMessages: () => Promise<void>;

  // UI Actions
  handleSidebarAction: (action: string, data: any) => void;
  handleMainContentAction: (action: string, data: any) => Promise<void>;
  handleRetryConnection: () => void;

  // Onboarding
  showOnboarding: boolean;
  handleOnboardingComplete: (onboardingState: OnboardingState) => Promise<void>;
  handleOnboardingSkip: () => void;
}

/**
 * Consolidated hook for app orchestration:
 * - Gateway connection
 * - Agents management
 * - Chat feature (sessions + messages + active sessions)
 * - UI actions (sidebar, menu, navigation)
 * - Onboarding flow
 */
export function useApp(): UseAppReturn {
  const navigate = useNavigate();
  const location = useLocation();

  // Gateway
  const {
    gatewayClient,
    connectionStatus,
    connect,
    updateConfig,
  } = useGateway();

  // Agents
  const { agents, currentAgentId, setCurrentAgentId, loadAgents } = useAgents(gatewayClient);

  // Chat feature (sessions + messages + active sessions)
  const {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    createSession,
    activeSessionIds,
    addToActiveSessions,
    removeFromActiveSessions,
    messages,
    isSending,
    sendMessage,
    loadMessages,
  } = useChat(gatewayClient, currentAgentId, currentAgentId);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !getStorageItem<string>("zuckerman:onboarding:completed", "");
  });

  // Auto-connect when gateway client is ready
  useEffect(() => {
    if (!gatewayClient) return;

    const isActuallyConnected = gatewayClient.isConnected();
    const needsReconnect = !isActuallyConnected && connectionStatus === "disconnected";

    if (needsReconnect) {
      console.log("[App] Gateway client not connected, attempting to connect...");
      connect();
    }
  }, [gatewayClient, connectionStatus, connect]);

  // Reconnect on mount/remount (handles HMR) - separate effect to ensure it runs
  useEffect(() => {
    if (!gatewayClient) return;

    // Small delay to ensure gateway server is ready and avoid race conditions
    const timeoutId = setTimeout(() => {
      if (gatewayClient && !gatewayClient.isConnected() && connectionStatus === "disconnected") {
        console.log("[App] Attempting reconnect after mount/HMR...");
        connect();
      }
    }, 1000); // Longer delay to ensure gateway server is ready

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayClient]); // Only depend on gatewayClient to trigger on mount/HMR

  // Load agents when connected
  useEffect(() => {
    if (connectionStatus === "connected" && gatewayClient?.isConnected()) {
      console.log("[App] Connection established, loading agents...");
      // Small delay to ensure connection is fully established
      const timeoutId = setTimeout(() => {
        loadAgents().catch((error) => {
          console.error("[App] Failed to load agents after connection:", error);
        });
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [connectionStatus, gatewayClient, loadAgents]);

  // Load sessions when agent is selected
  useEffect(() => {
    if (gatewayClient?.isConnected() && currentAgentId) {
      if (sessions.length === 0) {
        createSession("main", currentAgentId).catch(console.error);
      }
    }
  }, [gatewayClient, currentAgentId, sessions.length, createSession]);

  // UI Actions
  const handleRetryConnection = useCallback(() => {
    connect();
  }, [connect]);

  const handleSidebarAction = useCallback(
    (action: string, data: any) => {
      switch (action) {
        case "select-session":
          setCurrentSessionId(data.sessionId);
          addToActiveSessions(data.sessionId);
          navigate("/");
          break;
        case "restore-session":
          setCurrentSessionId(data.sessionId);
          addToActiveSessions(data.sessionId);
          navigate("/");
          break;
        case "archive-session":
          removeFromActiveSessions(data.sessionId);
          if (data.sessionId === currentSessionId) {
            const remainingActive = Array.from(activeSessionIds).filter(
              (id) => id !== data.sessionId
            );
            const nextActive = remainingActive.length > 0 ? remainingActive[0] : null;
            setCurrentSessionId(nextActive);
          }
          break;
        case "select-agent":
          setCurrentAgentId(data.agentId);
          navigate(`/agent/${data.agentId}`);
          break;
        case "new-session":
          if (currentAgentId) {
            createSession("main", currentAgentId)
              .then((newSession) => {
                // Add to active sessions
                addToActiveSessions(newSession.id);
                // Navigate to home if needed
                if (location.pathname !== "/") {
                  navigate("/");
                }
              })
              .catch((error) => {
                console.error("Failed to create session:", error);
                alert(`Failed to create session: ${error instanceof Error ? error.message : "Unknown error"}`);
              });
          } else {
            alert("Please select an agent first");
          }
          break;
        case "restart-onboarding":
          removeStorageItem("zuckerman:onboarding:completed");
          removeStorageItem("zuckerman:onboarding");
          window.location.reload();
          break;
        case "show-inspector":
          navigate("/inspector");
          break;
        case "show-settings":
          navigate("/settings");
          break;
        case "show-calendar":
          navigate("/calendar");
          break;
        case "navigate-home":
          navigate("/");
          break;
      }
    },
    [
      setCurrentSessionId,
      addToActiveSessions,
      removeFromActiveSessions,
      activeSessionIds,
      currentSessionId,
      setCurrentAgentId,
      currentAgentId,
      createSession,
      navigate,
      location.pathname,
    ]
  );

  const handleMainContentAction = useCallback(async (action: string, data: any) => {
    switch (action) {
      case "send-message":
        // Handled by useChat hook
        break;
      case "clear-conversation":
        // Clear conversation logic
        break;
    }
  }, []);

  // Electron menu actions
  useEffect(() => {
    if (!window.electronAPI) return;

    const handleMenuAction = (action: string) => {
      switch (action) {
        case "new-session":
          handleSidebarAction("new-session", {});
          break;
        case "settings":
          navigate("/settings");
          break;
        case "clear-conversation":
          handleMainContentAction("clear-conversation", {});
          break;
      }
    };

    window.electronAPI.onMenuAction(handleMenuAction);
    return () => {
      window.electronAPI.removeMenuListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSidebarAction, handleMainContentAction, navigate]);

  // Onboarding handlers
  const handleOnboardingComplete = useCallback(
    async (onboardingState: OnboardingState) => {
      setStorageItem("zuckerman:onboarding:completed", "true");

      if (onboardingState.agent.agentId) {
        setCurrentAgentId(onboardingState.agent.agentId);
      }

      setShowOnboarding(false);
      connect();
    },
    [setCurrentAgentId, connect]
  );

  const handleOnboardingSkip = useCallback(() => {
    setStorageItem("zuckerman:onboarding:completed", "true");
    setShowOnboarding(false);
  }, []);

  return {
    currentSessionId,
    currentAgentId,
    sessions,
    agents,
    connectionStatus,
    gatewayClient,
    setCurrentAgentId,
    setCurrentSessionId,
    createSession,
    connect,
    updateGatewayConfig: updateConfig,
    activeSessionIds,
    addToActiveSessions,
    removeFromActiveSessions,
    messages,
    isSending,
    sendMessage,
    loadMessages,
    handleSidebarAction,
    handleMainContentAction,
    handleRetryConnection,
    showOnboarding,
    handleOnboardingComplete,
    handleOnboardingSkip,
  };
}
