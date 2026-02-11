import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ZuckermanConfig, ModelTrait } from "./types.js";
import { getConfigPath, getAgentWorkspaceDir, getZuckermanBaseDir } from "@server/world/homedir/paths.js";

// Re-export for backward compatibility
export { getZuckermanBaseDir } from "@server/world/homedir/paths.js";

const CONFIG_PATH = getConfigPath();
const DEFAULT_WORKSPACE = getAgentWorkspaceDir("zuckerman");

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
        homedir: DEFAULT_WORKSPACE,
      },
    ],
    defaults: {
      homedir: DEFAULT_WORKSPACE,
    },
  },
  routing: {
    bindings: [],
  },
};

// Default trait mappings to initialize in config
const defaultTraitMappings: Record<string, Record<ModelTrait, string>> = {
  anthropic: {
    fastCheap: "claude-opus-4-6",
    cheap: "claude-opus-4-6",
    fast: "claude-opus-4-6",
    highQuality: "claude-opus-4-6",
    largeContext: "claude-opus-4-6",
  },
  openai: {
    fastCheap: "gpt-5.2",
    cheap: "gpt-5.2",
    fast: "gpt-4o-mini",
    highQuality: "gpt-5.2",
    largeContext: "gpt-5.2",
  },
  openrouter: {
    fastCheap: "deepseek/deepseek-chat",
    cheap: "deepseek/deepseek-chat",
    fast: "deepseek/deepseek-chat",
    highQuality: "anthropic/claude-opus-4-6",
    largeContext: "openai/gpt-5.2",
  },
};

export async function loadConfig(): Promise<ZuckermanConfig> {
  if (!existsSync(CONFIG_PATH)) {
    // Initialize config with default trait mappings
    const configWithTraits: ZuckermanConfig = {
      ...defaultConfig,
      llm: {
        anthropic: {
          defaultModel: "claude-sonnet-4-5",
          traits: defaultTraitMappings.anthropic,
        },
        openai: {
          defaultModel: "gpt-5.2",
          traits: defaultTraitMappings.openai,
        },
        openrouter: {
          traits: defaultTraitMappings.openrouter,
        },
      },
    };
    await saveConfig(configWithTraits);
    return configWithTraits;
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
    
    // Initialize LLM config if it doesn't exist
    if (!config.llm) {
      config.llm = {};
    }
    
    // Initialize provider-specific configs
    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      if (!config.llm[provider]) {
        config.llm[provider] = {};
      }
      if (!config.llm[provider]?.traits) {
        config.llm[provider]!.traits = defaultTraitMappings[provider];
        await saveConfig(config);
      }
      // Set default models if not present
      if (provider === "anthropic" && !config.llm[provider]?.defaultModel) {
        config.llm[provider]!.defaultModel = "claude-sonnet-4-5";
        await saveConfig(config);
      }
      if (provider === "openai" && !config.llm[provider]?.defaultModel) {
        config.llm[provider]!.defaultModel = "gpt-5.2";
        await saveConfig(config);
      }
    }
    
    return config;
  } catch {
    return defaultConfig;
  }
}

export async function saveConfig(config: ZuckermanConfig): Promise<void> {
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
