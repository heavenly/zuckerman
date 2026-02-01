import React, { useEffect } from "react";
import { MemoryRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useApp } from "./hooks/use-app";
import { Sidebar } from "./components/layout/sidebar";
import { TitleBar } from "./components/layout/title-bar";
import { OnboardingFlow } from "./features/onboarding/onboarding-flow";
import { ConnectionError } from "./features/gateway/connection-error";
import { HomePage } from "./features/home/home-page";
import { SettingsPage } from "./features/home/settings/settings-page";
import { InspectorPage } from "./features/home/inspector-page";
import { AgentPage } from "./features/home/agent/agent-page";
import { CalendarPage } from "./features/home/calendar/calendar-page";

declare global {
  interface Window {
    platform?: {
      isMac: boolean;
      isWindows: boolean;
      isLinux: boolean;
    };
  }
}


function AppContent() {
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const showConnectionError = app.connectionStatus === "disconnected";

  // Redirect to agent page by default when agent is selected and on home page
  // But only if there's no current session (user hasn't explicitly selected a session)
  useEffect(() => {
    if (
      !showConnectionError &&
      !app.showOnboarding &&
      app.currentAgentId &&
      location.pathname === "/" &&
      !app.currentSessionId
    ) {
      navigate(`/agent/${app.currentAgentId}`);
    }
  }, [app.currentAgentId, app.currentSessionId, location.pathname, navigate, showConnectionError, app.showOnboarding]);

  if (app.showOnboarding) {
    return (
      <OnboardingFlow
        onComplete={app.handleOnboardingComplete}
        onSkip={app.handleOnboardingSkip}
        gatewayClient={app.gatewayClient}
      />
    );
  }

  return (
    <div
      className="flex flex-col bg-background text-foreground overflow-hidden relative"
      style={{
        width: "100vw",
        height: "100vh",
        maxWidth: "100vw",
        maxHeight: "100vh",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        backgroundColor: 'hsl(var(--background))',
      }}
    >
      <TitleBar />
      {showConnectionError ? (
        <ConnectionError onRetry={app.handleRetryConnection} />
      ) : (
        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          <Sidebar
            state={app}
            activeSessionIds={app.activeSessionIds}
            onAction={app.handleSidebarAction}
          />
          <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0, minHeight: 0 }}>
            <Routes>
              <Route
                path="/"
                element={<HomePage state={app} onMainContentAction={app.handleMainContentAction} />}
              />
              <Route 
                path="/settings" 
                element={
                  <SettingsPage
                    gatewayClient={app.gatewayClient}
                    onClose={() => app.handleSidebarAction("navigate-home", {})}
                    onGatewayConfigChange={app.updateGatewayConfig}
                  />
                } 
              />
              <Route 
                path="/inspector" 
                element={
                  <InspectorPage
                    gatewayClient={app.gatewayClient}
                    onClose={() => app.handleSidebarAction("navigate-home", {})}
                  />
                } 
              />
              <Route 
                path="/calendar" 
                element={
                  <CalendarPage
                    onClose={() => app.handleSidebarAction("navigate-home", {})}
                  />
                } 
              />
              <Route 
                path="/agent/:agentId" 
                element={
                  <AgentPage
                    state={app}
                    gatewayClient={app.gatewayClient}
                    onClose={() => app.handleSidebarAction("navigate-home", {})}
                  />
                } 
              />
            </Routes>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  console.log("App component rendering...");

  return (
    <MemoryRouter>
      <AppContent />
    </MemoryRouter>
  );
}
