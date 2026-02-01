import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { GatewayClient } from "../../../core/gateway/client";
import { Server, Palette, Settings as SettingsIcon, CheckCircle2, XCircle, Power, Loader2, Trash2, Shield } from "lucide-react";
import { useGateway } from "../../../hooks/use-gateway";
import { GatewayLogsViewer } from "../../../components/gateway-logs-viewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearStorageByPrefix } from "../../../core/storage/local-storage";

interface SettingsProps {
  gatewayClient: GatewayClient | null;
  onClose?: () => void;
  onGatewayConfigChange?: (host: string, port: number) => void;
}

type SettingsTab = "gateway" | "appearance" | "security" | "advanced";

interface SettingsState {
  gateway: {
    host: string;
    port: number;
    autoStart: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    fontSize: string;
  };
  advanced: {
    autoReconnect: boolean;
    reconnectAttempts: number;
  };
}

export function SettingsView({
  gatewayClient,
  onClose,
  onGatewayConfigChange,
}: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("gateway");
  const [settings, setSettings] = useState<SettingsState>(() => {
    const stored = localStorage.getItem("zuckerman:settings");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fallback to defaults
      }
    }
    return {
      gateway: {
        host: "127.0.0.1",
        port: 18789,
        autoStart: true,
      },
      appearance: {
        theme: "system",
        fontSize: "14",
      },
      advanced: {
        autoReconnect: true,
        reconnectAttempts: 5,
      },
    };
  });

  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [toolRestrictions, setToolRestrictions] = useState<{
    profile: "minimal" | "coding" | "messaging" | "full";
    enabledTools: Set<string>;
  }>({
    profile: "full",
    enabledTools: new Set(["terminal", "browser", "cron", "device", "filesystem", "canvas"]),
  });
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  
  const {
    serverStatus,
    isServerLoading,
    isServerStarting,
    isServerStopping,
    startServer,
    stopServer,
    checkServerStatus,
    startPolling,
    stopPolling,
  } = useGateway();

  useEffect(() => {
    // Load current settings when component mounts
    const stored = localStorage.getItem("zuckerman:settings");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings(parsed);
        // Check gateway status with loaded settings
        if (window.electronAPI && parsed.gateway) {
          checkServerStatus(parsed.gateway.host, parsed.gateway.port);
        }
      } catch {}
    } else {
      // Check gateway status with default settings
      if (window.electronAPI) {
        checkServerStatus(settings.gateway.host, settings.gateway.port);
      }
    }
    setHasChanges(false);
    setConnectionStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load tool restrictions from config
  useEffect(() => {
    const loadToolRestrictions = async () => {
      if (!gatewayClient?.isConnected()) return;
      
      setIsLoadingTools(true);
      try {
        const response = await gatewayClient.request("config.get", {});
        
        if (response.ok && response.result) {
          const config = (response.result as { config: any }).config;
          const securityConfig = config?.security;
          const toolsConfig = securityConfig?.tools;
          
          if (toolsConfig) {
            const profile = toolsConfig.profile || "full";
            const enabledTools = new Set<string>();
            
            // If profile is "full", all tools are enabled
            if (profile === "full") {
              enabledTools.add("terminal");
              enabledTools.add("browser");
              enabledTools.add("cron");
              enabledTools.add("device");
              enabledTools.add("filesystem");
              enabledTools.add("canvas");
            } else if (toolsConfig.allow) {
              // If there's an allow list, use it
              toolsConfig.allow.forEach((tool: string) => {
                if (!tool.startsWith("group:")) {
                  enabledTools.add(tool);
                }
              });
            }
            
            setToolRestrictions({ profile, enabledTools });
          }
        }
      } catch (error) {
        console.error("Failed to load tool restrictions:", error);
      } finally {
        setIsLoadingTools(false);
      }
    };

    if (gatewayClient?.isConnected()) {
      loadToolRestrictions();
    }
  }, [gatewayClient]);

  // Check gateway status when settings change
  useEffect(() => {
    if (window.electronAPI && activeTab === "gateway") {
      checkServerStatus(settings.gateway.host, settings.gateway.port);
      // Start polling when on gateway tab
      startPolling(settings.gateway.host, settings.gateway.port, 5000);
    } else {
      // Stop polling when leaving gateway tab
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [settings.gateway.host, settings.gateway.port, activeTab, checkServerStatus, startPolling, stopPolling]);

  const handleSave = () => {
    localStorage.setItem("zuckerman:settings", JSON.stringify(settings));
    
    // Apply gateway config changes if provided
    if (onGatewayConfigChange && hasChanges) {
      onGatewayConfigChange(settings.gateway.host, settings.gateway.port);
    }

    // Apply theme if changed
    if (settings.appearance.theme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (settings.appearance.theme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      // System theme - check system preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }

    setHasChanges(false);
  };

  const handleTestConnection = async () => {
    setConnectionStatus("testing");
    try {
      const testClient = new GatewayClient({
        host: settings.gateway.host,
        port: settings.gateway.port,
      });
      
      await Promise.race([
        testClient.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Connection timeout")), 5000)
        ),
      ]) as Promise<void>;
      
      testClient.disconnect();
      setConnectionStatus("success");
      setTimeout(() => setConnectionStatus("idle"), 3000);
    } catch (error) {
      setConnectionStatus("error");
      setTimeout(() => setConnectionStatus("idle"), 3000);
    }
  };

  const updateSettings = <K extends keyof SettingsState>(
    section: K,
    updates: Partial<SettingsState[K]>
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...updates },
    }));
    setHasChanges(true);
  };

  const handleReset = async () => {
    if (!window.electronAPI) {
      console.error("Electron API not available");
      return;
    }

    setIsResetting(true);
    try {
      // First, delete all sessions via gateway API if connected
      // This clears sessions from gateway server's memory
      if (gatewayClient?.isConnected()) {
        try {
          const sessionsResponse = await gatewayClient.request("sessions.list");
          if (sessionsResponse.ok && sessionsResponse.result) {
            const sessions = (sessionsResponse.result as { sessions?: Array<{ id: string }> }).sessions || [];
            // Delete all sessions
            for (const session of sessions) {
              try {
                await gatewayClient.request("sessions.delete", { id: session.id });
              } catch (err) {
                console.warn(`Failed to delete session ${session.id}:`, err);
              }
            }
          }
        } catch (err) {
          console.warn("Failed to delete sessions via gateway:", err);
        }
      }

      // Clear all localStorage cache (includes active sessions, settings, etc.)
      clearStorageByPrefix("zuckerman:");
      
      // Delete server-side data directory (.zuckerman folder)
      const result = await window.electronAPI.resetAllData();
      if (result.success) {
        // Restart gateway server to ensure it reloads with clean state
        const gatewaySettings = settings.gateway;
        try {
          await stopServer(gatewaySettings.host, gatewaySettings.port);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await startServer(gatewaySettings.host, gatewaySettings.port);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          console.warn("Failed to restart gateway:", err);
        }

        setShowResetDialog(false);
        // Reload the app to clear all state
        window.location.reload();
      } else {
        alert(`Failed to reset data: ${result.error || "Unknown error"}`);
        setIsResetting(false);
      }
    } catch (error) {
      alert(`Error resetting data: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsResetting(false);
    }
  };

  const handleToolToggle = async (toolId: string) => {
    if (!gatewayClient?.isConnected()) {
      alert("Gateway not connected");
      return;
    }

    const newEnabledTools = new Set(toolRestrictions.enabledTools);
    if (newEnabledTools.has(toolId)) {
      newEnabledTools.delete(toolId);
    } else {
      newEnabledTools.add(toolId);
    }

    // If all tools are enabled, set profile to "full", otherwise use allow list
    const allTools = ["terminal", "browser", "cron", "device", "filesystem", "canvas"];
    const allEnabled = allTools.every((tool) => newEnabledTools.has(tool));
    
    const updates: any = {
      security: {
        tools: allEnabled
          ? { profile: "full" }
          : { profile: "full", allow: Array.from(newEnabledTools) },
      },
    };

    try {
      const response = await gatewayClient.request("config.update", { updates });

      if (response.ok) {
        setToolRestrictions({
          profile: allEnabled ? "full" : toolRestrictions.profile,
          enabledTools: newEnabledTools,
        });
      } else {
        alert(`Failed to update tool restrictions: ${response.error?.message || "Unknown error"}`);
      }
    } catch (error) {
      alert(`Error updating tool restrictions: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleEnableAllTools = async () => {
    if (!gatewayClient?.isConnected()) {
      alert("Gateway not connected");
      return;
    }

    const allTools = ["terminal", "browser", "cron", "device", "filesystem", "canvas"];
    const updates: any = {
      security: {
        tools: { profile: "full" },
      },
    };

    try {
      const response = await gatewayClient.request("config.update", { updates });

      if (response.ok) {
        setToolRestrictions({
          profile: "full",
          enabledTools: new Set(allTools),
        });
      } else {
        alert(`Failed to enable all tools: ${response.error?.message || "Unknown error"}`);
      }
    } catch (error) {
      alert(`Error enabling all tools: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
    { id: "gateway", label: "Gateway", icon: <Server className="h-4 w-4" /> },
    { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
    { id: "security", label: "Security", icon: <Shield className="h-4 w-4" /> },
    { id: "advanced", label: "Advanced", icon: <SettingsIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto w-full px-6 py-8">
          {/* GitHub-style header */}
          <div className="mb-8 pb-6 border-b border-border">
            <div className="flex items-center gap-1 mb-6">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    px-3 py-1.5 text-sm font-medium rounded-md transition-colors
                    ${activeTab === tab.id 
                      ? "bg-accent text-accent-foreground" 
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}
                  `}
                >
                  <div className="flex items-center gap-2">
                    {tab.icon}
                    {tab.label}
                  </div>
                </button>
              ))}
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-1">
              {tabs.find(t => t.id === activeTab)?.label}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeTab === "gateway" && "Turn the gateway server on or off."}
              {activeTab === "appearance" && "Customize how the application looks and feels."}
              {activeTab === "security" && "Configure security settings and tool restrictions."}
              {activeTab === "advanced" && "Configure gateway connection settings and advanced options."}
            </p>
          </div>

          <div className="space-y-6">
            {activeTab === "gateway" && (
              <React.Fragment>
                {/* GitHub-style section */}
                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground">Gateway Server</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {window.electronAPI 
                        ? "Control the gateway server process."
                        : "Gateway management requires Electron API."}
                    </p>
                  </div>
                  <div className="px-6 py-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {serverStatus && (
                          <div className="flex items-center gap-2 text-sm">
                            {serverStatus.running ? (
                              <>
                                <div className="h-2 w-2 rounded-full bg-[#3fb950]"></div>
                                <span className="text-muted-foreground">Running</span>
                              </>
                            ) : (
                              <>
                                <div className="h-2 w-2 rounded-full bg-muted-foreground"></div>
                                <span className="text-muted-foreground">Stopped</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {window.electronAPI && (
                        <Button
                          variant={serverStatus?.running ? "destructive" : "default"}
                          size="default"
                          onClick={async () => {
                            if (serverStatus?.running) {
                              const success = await stopServer(
                                settings.gateway.host,
                                settings.gateway.port
                              );
                              // Client disconnect is handled in stopServer
                            } else {
                              const success = await startServer(
                                settings.gateway.host,
                                settings.gateway.port
                              );
                              if (success && gatewayClient) {
                                setTimeout(() => {
                                  gatewayClient.connect().catch(() => {
                                    // Connection will be handled by App component
                                  });
                                }, 1000);
                              }
                            }
                          }}
                          disabled={isServerStopping || isServerStarting}
                        >
                          {isServerStopping ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Turning off...
                            </>
                          ) : isServerStarting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Turning on...
                            </>
                          ) : serverStatus?.running ? (
                            <>
                              <Power className="h-4 w-4 mr-2" />
                              Turn Off
                            </>
                          ) : (
                            <>
                              <Power className="h-4 w-4 mr-2" />
                              Turn On
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {serverStatus?.error && (
                      <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-md">
                        {serverStatus.error}
                      </div>
                    )}
                  </div>
                </div>

                {/* Auto-start option */}
                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="gateway-auto-start"
                        checked={settings.gateway.autoStart}
                        onCheckedChange={(checked) =>
                          updateSettings("gateway", {
                            autoStart: checked === true,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="gateway-auto-start" className="cursor-pointer text-sm font-medium text-foreground">
                          Auto-start gateway on app launch
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Automatically start the gateway server when the app launches.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Test connection */}
                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={connectionStatus === "testing"}
                      >
                        {connectionStatus === "testing" && "Testing..."}
                        {connectionStatus === "idle" && "Test connection"}
                        {connectionStatus === "success" && (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            Connected
                          </>
                        )}
                        {connectionStatus === "error" && (
                          <>
                            <XCircle className="h-4 w-4 mr-2" />
                            Connection failed
                          </>
                        )}
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        Verify that the gateway is reachable with current settings.
                      </p>
                    </div>
                  </div>
                </div>

                {window.electronAPI && (
                  <div className="border border-border rounded-md bg-card">
                    <div className="px-6 py-4 border-b border-border">
                      <h2 className="text-base font-semibold text-foreground">Gateway Logs</h2>
                      <p className="text-sm text-muted-foreground mt-1">
                        View real-time logs from the gateway server process.
                      </p>
                    </div>
                    <div className="px-6 py-4">
                      <GatewayLogsViewer limit={200} />
                    </div>
                  </div>
                )}
              </React.Fragment>
            )}

            {activeTab === "appearance" && (
              <div className="border border-border rounded-md bg-card">
                <div className="px-6 py-4 border-b border-border">
                  <h2 className="text-base font-semibold text-foreground">Appearance</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Customize how the application looks and feels.
                  </p>
                </div>
                <div className="px-6 py-4 space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="theme" className="text-sm font-medium text-foreground">
                      Theme preference
                    </Label>
                    <Select
                      value={settings.appearance.theme}
                      onValueChange={(value: "light" | "dark" | "system") =>
                        updateSettings("appearance", { theme: value })
                      }
                    >
                      <SelectTrigger id="theme" className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="system">Sync with system</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Choose how Zuckerman looks to you.
                    </p>
                  </div>

                  <div className="border-t border-border pt-6 space-y-2">
                    <Label htmlFor="font-size" className="text-sm font-medium text-foreground">
                      Text size
                    </Label>
                    <Select
                      value={settings.appearance.fontSize}
                      onValueChange={(value) =>
                        updateSettings("appearance", { fontSize: value })
                      }
                    >
                      <SelectTrigger id="font-size" className="w-[240px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="12">12px (Small)</SelectItem>
                        <SelectItem value="14">14px (Medium)</SelectItem>
                        <SelectItem value="16">16px (Large)</SelectItem>
                        <SelectItem value="18">18px (Extra Large)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">
                      Adjust the font size for the chat and interface.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <React.Fragment>
                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4 border-b border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">Tool Restrictions</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          Select which tools your agent can use.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEnableAllTools}
                        disabled={!gatewayClient?.isConnected() || isLoadingTools}
                      >
                        Enable All
                      </Button>
                    </div>
                  </div>
                  <div className="px-6 py-4">
                    {isLoadingTools ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-sm text-muted-foreground">Loading tools...</span>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[
                          { id: "terminal", label: "Terminal", description: "Execute shell commands" },
                          { id: "browser", label: "Browser", description: "Web browsing and automation" },
                          { id: "filesystem", label: "Filesystem", description: "Read and write files" },
                          { id: "cron", label: "Cron", description: "Scheduled tasks" },
                          { id: "device", label: "Device", description: "Device access and control" },
                          { id: "canvas", label: "Canvas", description: "UI rendering and interaction" },
                        ].map((tool) => (
                          <label
                            key={tool.id}
                            className="flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-accent/50 transition-colors"
                          >
                            <Checkbox
                              checked={toolRestrictions.enabledTools.has(tool.id)}
                              onCheckedChange={() => handleToolToggle(tool.id)}
                              disabled={!gatewayClient?.isConnected()}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="font-medium text-sm text-foreground">{tool.label}</div>
                              <div className="text-sm text-muted-foreground">{tool.description}</div>
                            </div>
                          </label>
                        ))}
                        {!gatewayClient?.isConnected() && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Connect to gateway to manage tool restrictions.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </React.Fragment>
            )}

            {activeTab === "advanced" && (
              <React.Fragment>
                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground">Gateway Configuration</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure gateway connection settings.
                    </p>
                  </div>
                  <div className="px-6 py-4 space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="gateway-host" className="text-sm font-medium text-foreground">
                        Gateway Host
                      </Label>
                      <Input
                        id="gateway-host"
                        value={settings.gateway.host}
                        onChange={(e) =>
                          updateSettings("gateway", { host: e.target.value })
                        }
                        placeholder="127.0.0.1"
                        className="max-w-md"
                      />
                      <p className="text-sm text-muted-foreground">
                        The hostname or IP address of your Zuckerman Gateway. Default is 127.0.0.1.
                      </p>
                    </div>

                    <div className="border-t border-border pt-6 space-y-2">
                      <Label htmlFor="gateway-port" className="text-sm font-medium text-foreground">
                        Gateway Port
                      </Label>
                      <Input
                        id="gateway-port"
                        type="number"
                        value={settings.gateway.port}
                        onChange={(e) =>
                          updateSettings("gateway", {
                            port: parseInt(e.target.value) || 18789,
                          })
                        }
                        placeholder="18789"
                        min="1"
                        max="65535"
                        className="w-32"
                      />
                      <p className="text-sm text-muted-foreground">
                        The port number the gateway is listening on. Default is 18789.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-border rounded-md bg-card">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-foreground">Connection Settings</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure advanced connection behavior.
                    </p>
                  </div>
                  <div className="px-6 py-4 space-y-6">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="auto-reconnect"
                        checked={settings.advanced.autoReconnect}
                        onCheckedChange={(checked) =>
                          updateSettings("advanced", {
                            autoReconnect: checked === true,
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <Label htmlFor="auto-reconnect" className="cursor-pointer text-sm font-medium text-foreground">
                          Auto-reconnect
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Automatically attempt to reconnect to the gateway if the connection is lost.
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-border pt-6 space-y-2">
                      <Label htmlFor="reconnect-attempts" className="text-sm font-medium text-foreground">
                        Maximum reconnection attempts
                      </Label>
                      <Input
                        id="reconnect-attempts"
                        type="number"
                        value={settings.advanced.reconnectAttempts}
                        onChange={(e) =>
                          updateSettings("advanced", {
                            reconnectAttempts: parseInt(e.target.value) || 5,
                          })
                        }
                        min="1"
                        max="20"
                        className="w-24"
                      />
                      <p className="text-sm text-muted-foreground">
                        How many times the application will try to reconnect before showing an error.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border border-destructive/50 rounded-md bg-card">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-base font-semibold text-destructive">Danger Zone</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Irreversible and destructive actions.
                    </p>
                  </div>
                  <div className="px-6 py-4">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-medium text-foreground mb-1">Reset All Data</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          This will permanently delete all Zuckerman data including:
                        </p>
                        <ul className="text-sm text-muted-foreground list-disc list-inside mb-4 space-y-1">
                          <li>All chat history and sessions</li>
                          <li>Agent configurations</li>
                          <li>Memory and transcripts</li>
                          <li>All other stored data</li>
                        </ul>
                        <Button
                          variant="destructive"
                          onClick={() => setShowResetDialog(true)}
                          disabled={!window.electronAPI}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Reset All Data
                        </Button>
                        {!window.electronAPI && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Reset functionality requires Electron API.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset All Data</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all Zuckerman data? This action cannot be undone.
              <br />
              <br />
              This will permanently delete:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>All chat history and sessions</li>
                <li>Agent configurations</li>
                <li>Memory and transcripts</li>
                <li>All other stored data</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={isResetting}
            >
              {isResetting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Reset All Data
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {hasChanges && (
        <div className="border-t border-border bg-card px-6 py-4 flex items-center justify-end">
          <Button 
            onClick={handleSave}
            className="bg-[#0969da] hover:bg-[#0860ca] text-white"
          >
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
