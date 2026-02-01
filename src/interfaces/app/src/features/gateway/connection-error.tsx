import React, { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { gatewayService } from "../../core/gateway/gateway-service";

interface GatewayConnectionErrorProps {
  onRetry?: () => void;
}

export function ConnectionError({ onRetry }: GatewayConnectionErrorProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    if (!window.electronAPI) {
      console.error("Electron API not available");
      return;
    }

    setIsConnecting(true);
    try {
      // Initialize gateway service if not already initialized
      gatewayService.initialize(window.electronAPI);
      
      // Clear explicitly stopped flag to allow starting
      localStorage.removeItem("zuckerman:gateway:explicitly-stopped");
      
      // Start the gateway (like on startup)
      const result = await gatewayService.ensureRunning();
      
      if (result.success) {
        // Wait a moment for the gateway to be ready, then connect
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        // Try to connect
        if (onRetry) {
          onRetry();
        }
      } else {
        console.error("Failed to start gateway:", result.error);
        // Still try to connect in case it's already running
        if (onRetry) {
          setTimeout(() => onRetry(), 500);
        }
      }
    } catch (error) {
      console.error("Error starting gateway:", error);
      // Still try to connect
      if (onRetry) {
        setTimeout(() => onRetry(), 500);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <CardTitle>Gateway Not Connected</CardTitle>
          </div>
          <CardDescription>
            Unable to connect to the gateway server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center pt-4">
            <Button 
              onClick={handleConnect} 
              disabled={isConnecting}
              size="lg"
              className="min-w-[140px]"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
