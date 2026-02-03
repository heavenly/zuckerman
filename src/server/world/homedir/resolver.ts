import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import type { ZuckermanConfig } from "@server/world/config/types.js";

/**
 * Default homedir directory
 */
export const DEFAULT_HOMEDIR_DIR = join(homedir(), ".zuckerman", "homedir");

/**
 * Resolve homedir directory for an agent
 */
export function resolveAgentHomedirDir(
  config: ZuckermanConfig,
  agentId: string,
): string {
  // Check if agent has specific homedir configured
  const agents = config.agents?.list || [];
  const agent = agents.find((a) => a.id === agentId);

  if (agent?.homedir) {
    return expandPath(agent.homedir);
  }

  // Use default homedir
  const defaultHomedir = config.agents?.defaults?.homedir || DEFAULT_HOMEDIR_DIR;
  const expandedDefault = expandPath(defaultHomedir);

  // If it's the default agent, use homedir as-is
  const defaultAgent = agents.find((a) => a.default) || agents[0];
  if (agentId === defaultAgent?.id) {
    return expandedDefault;
  }

  // Otherwise append agent ID
  return `${expandedDefault}-${agentId}`;
}

/**
 * Expand ~ in paths
 */
function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", homedir());
  }
  return path;
}

/**
 * Ensure homedir directory exists
 */
export function ensureHomedirDir(homedirDir: string): void {
  if (!existsSync(homedirDir)) {
    mkdirSync(homedirDir, { recursive: true });
  }
}
