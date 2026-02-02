import { useMemo } from "react";
import { useGatewayContext } from "./use-gateway-context";
import type { ServiceContainer } from "./service-registry";

/**
 * Convenience hooks for accessing services from the registry
 * These hooks abstract away the registry access pattern
 */

export function useConversationService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "conversationService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useMessageService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "messageService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useAgentService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "agentService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useHealthService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "healthService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useWhatsAppService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "whatsappService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useTelegramService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "telegramService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useDiscordService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "discordService"),
    [gatewayClient, serviceRegistry]
  );
}

export function useSignalService() {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getService(gatewayClient, "signalService"),
    [gatewayClient, serviceRegistry]
  );
}

/**
 * Get all services at once (useful when you need multiple services)
 */
export function useServices(): ServiceContainer | null {
  const { gatewayClient, serviceRegistry } = useGatewayContext();
  return useMemo(
    () => serviceRegistry.getContainer(gatewayClient),
    [gatewayClient, serviceRegistry]
  );
}
