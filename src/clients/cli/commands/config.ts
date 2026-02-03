import { Command } from "commander";
import { loadConfig, saveConfig } from "@server/world/config/index.js";
import { outputJson, shouldOutputJson, parseJsonInput } from "../utils/json-output.js";
import * as readline from "node:readline";

export function createConfigCommand(): Command {
  const cmd = new Command("config")
    .description("Manage configuration");

  cmd
    .command("get")
    .description("Get current configuration")
    .option("--json", "Output as JSON")
    .option("--key <key>", "Get specific config key (e.g., 'agents.defaults.homedir')")
    .action(async (options: { json?: boolean; key?: string }) => {
      const config = await loadConfig();

      if (options.key) {
        // Get nested key value
        const keys = options.key.split(".");
        let value: unknown = config;
        for (const key of keys) {
          if (value && typeof value === "object" && key in value) {
            value = (value as Record<string, unknown>)[key];
          } else {
            console.error(`Config key "${options.key}" not found`);
            process.exit(1);
          }
        }
        if (shouldOutputJson(options)) {
          outputJson({ key: options.key, value }, options);
        } else {
          console.log(JSON.stringify(value, null, 2));
        }
      } else {
        if (shouldOutputJson(options)) {
          outputJson(config, options);
        } else {
          console.log(JSON.stringify(config, null, 2));
        }
      }
    });

  cmd
    .command("set")
    .description("Set configuration value")
    .option("--key <key>", "Config key to set (e.g., 'agents.defaults.homedir')")
    .option("--value <value>", "Value to set (JSON string)")
    .option("--input <json>", "JSON input for full config update (or pipe JSON)")
    .action(async (options: { key?: string; value?: string; input?: string }) => {
      const config = await loadConfig();

      if (options.input || !process.stdin.isTTY) {
        // Full config update from JSON
        const input = await parseJsonInput(options.input);
        await saveConfig(input as typeof config as any);
        console.log("Configuration updated successfully.");
      } else if (options.key && options.value) {
        // Set specific key
        try {
          const value = JSON.parse(options.value);
          const keys = options.key.split(".");
          const lastKey = keys.pop()!;
          let target: Record<string, unknown> = config as any;
          
          for (const key of keys) {
            if (!(key in target) || typeof target[key] !== "object") {
              target[key] = {};
            }
            target = target[key] as Record<string, unknown>;
          }
          
          target[lastKey] = value;
          await saveConfig(config as any);
          console.log(`Configuration key "${options.key}" updated successfully.`);
        } catch (err) {
          console.error("Failed to update config:", err instanceof Error ? err.message : "Unknown error");
          process.exit(1);
        }
      } else {
        console.error("Either --input or both --key and --value must be provided");
        process.exit(1);
      }
    });

  // Keys management subcommand
  cmd
    .command("keys")
    .description("Manage API keys for LLM providers")
    .option("--get", "Show all API keys (masked)")
    .option("--set <provider>", "Set API key for provider (anthropic|openai|openrouter)")
    .option("--key <key>", "API key value (or will prompt)")
    .option("--remove <provider>", "Remove API key for provider")
    .action(async (options: { get?: boolean; set?: string; key?: string; remove?: string }) => {
      const config = await loadConfig();

      if (options.get) {
        // Show masked keys
        const keys: Record<string, string> = {};
        if (config.llm?.anthropic?.apiKey) {
          const key = config.llm.anthropic.apiKey;
          keys.anthropic = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "***";
        }
        if (config.llm?.openai?.apiKey) {
          const key = config.llm.openai.apiKey;
          keys.openai = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "***";
        }
        if (config.llm?.openrouter?.apiKey) {
          const key = config.llm.openrouter.apiKey;
          keys.openrouter = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "***";
        }

        if (Object.keys(keys).length === 0) {
          console.log("No API keys configured.");
        } else {
          console.log("Configured API keys:");
          for (const [provider, masked] of Object.entries(keys)) {
            console.log(`  ${provider}: ${masked}`);
          }
        }
      } else if (options.set) {
        // Set API key
        const provider = options.set.toLowerCase();
        if (!["anthropic", "openai", "openrouter"].includes(provider)) {
          console.error(`Invalid provider: ${provider}. Must be one of: anthropic, openai, openrouter`);
          process.exit(1);
        }

        let apiKey = options.key;
        if (!apiKey) {
          // Prompt for key
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          apiKey = await new Promise<string>((resolve) => {
            rl.question(`Enter ${provider} API key: `, (answer) => {
              rl.close();
              resolve(answer.trim());
            });
          });
        }

        if (!apiKey) {
          console.error("API key cannot be empty");
          process.exit(1);
        }

        // Update config
        if (!config.llm) {
          config.llm = {};
        }
        if (provider === "anthropic") {
          if (!config.llm.anthropic) {
            config.llm.anthropic = {};
          }
          config.llm.anthropic.apiKey = apiKey;
        } else if (provider === "openai") {
          if (!config.llm.openai) {
            config.llm.openai = {};
          }
          config.llm.openai.apiKey = apiKey;
        } else if (provider === "openrouter") {
          if (!config.llm.openrouter) {
            config.llm.openrouter = {};
          }
          config.llm.openrouter.apiKey = apiKey;
        }

        await saveConfig(config);
        console.log(`${provider} API key saved successfully.`);
      } else if (options.remove) {
        // Remove API key
        const provider = options.remove.toLowerCase();
        if (!["anthropic", "openai", "openrouter"].includes(provider)) {
          console.error(`Invalid provider: ${provider}. Must be one of: anthropic, openai, openrouter`);
          process.exit(1);
        }

        if (config.llm) {
          if (provider === "anthropic" && config.llm.anthropic) {
            delete config.llm.anthropic.apiKey;
            if (Object.keys(config.llm.anthropic).length === 0) {
              delete config.llm.anthropic;
            }
          } else if (provider === "openai" && config.llm.openai) {
            delete config.llm.openai.apiKey;
            if (Object.keys(config.llm.openai).length === 0) {
              delete config.llm.openai;
            }
          } else if (provider === "openrouter" && config.llm.openrouter) {
            delete config.llm.openrouter.apiKey;
            if (Object.keys(config.llm.openrouter).length === 0) {
              delete config.llm.openrouter;
            }
          }

          if (Object.keys(config.llm).length === 0) {
            delete config.llm;
          }
        }

        await saveConfig(config);
        console.log(`${provider} API key removed successfully.`);
      } else {
        console.error("Use --get, --set <provider>, or --remove <provider>");
        process.exit(1);
      }
    });

  return cmd;
}
