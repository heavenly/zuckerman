import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ZuckermanConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".zuckerman", "config.json");
const DEFAULT_HOMEDIR = join(homedir(), ".zuckerman", "homedir");

const defaultConfig: ZuckermanConfig = {
  gateway: {
    port: 18789,
    host: "127.0.0.1",
    bind: "loopback",
  },
  agents: {
    list: [
      {
        id: "zuckerman",
        default: true,
        homedir: DEFAULT_HOMEDIR,
      },
    ],
    defaults: {
      homedir: DEFAULT_HOMEDIR,
    },
  },
  routing: {
    bindings: [],
  },
};

export async function loadConfig(): Promise<ZuckermanConfig> {
  if (!existsSync(CONFIG_PATH)) {
    await saveConfig(defaultConfig);
    return defaultConfig;
  }

  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    const config = JSON.parse(content) as ZuckermanConfig;
    
    // Ensure required structure exists
    if (!config.agents?.list) {
      config.agents = defaultConfig.agents;
    }
    if (!config.routing) {
      config.routing = defaultConfig.routing;
    }
    
    return config;
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: ZuckermanConfig): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const content = JSON.stringify(config, null, 2);
  await writeFile(CONFIG_PATH, content, "utf-8");
  
  // Verify the write succeeded
  const written = await readFile(CONFIG_PATH, "utf-8");
  const writtenConfig = JSON.parse(written) as ZuckermanConfig;
  if (config.llm && writtenConfig.llm && JSON.stringify(writtenConfig.llm) !== JSON.stringify(config.llm)) {
    console.warn("[Config] Warning: Written config.llm doesn't match expected config.llm");
    console.warn("[Config] Expected:", JSON.stringify(config.llm, null, 2));
    console.warn("[Config] Written:", JSON.stringify(writtenConfig.llm, null, 2));
  }
}
