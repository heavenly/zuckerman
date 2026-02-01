import { Command } from "commander";
import { startGatewayServer } from "@world/communication/gateway/server/index.js";
import { killPort } from "src/utils/kill-port.js";
import { GatewayClient } from "../gateway-client.js";
import { isGatewayRunning } from "../gateway-utils.js";
import { outputJson, shouldOutputJson } from "../utils/json-output.js";

export function createGatewayCommand(): Command {
  const cmd = new Command("gateway")
    .description("Control the gateway server (part of World)");

  cmd
    .command("start")
    .description("Start the gateway server")
    .option("-p, --port <port>", "Port number", "18789")
    .option("-h, --host <host>", "Host address", "127.0.0.1")
    .option("-v, --verbose", "Verbose logging")
    .action(async (options: { port: string; host: string; verbose?: boolean }) => {
      const port = parseInt(options.port, 10);
      const host = options.host;

      // Check if already running
      if (await isGatewayRunning(host, port)) {
        console.log(`Gateway is already running on ws://${host}:${port}`);
        return;
      }

      console.log(`Starting gateway on ws://${host}:${port}...`);

      try {
        // Kill any existing processes on the port
        await killPort(port);

        const server = await startGatewayServer({ port, host });
        console.log(`✓ Gateway started on ws://${host}:${port}`);

        // Graceful shutdown
        process.on("SIGINT", async () => {
          console.log("\nShutting down gateway...");
          await server.close("SIGINT");
          process.exit(0);
        });

        process.on("SIGTERM", async () => {
          console.log("\nShutting down gateway...");
          await server.close("SIGTERM");
          process.exit(0);
        });
      } catch (err) {
        console.error("Failed to start gateway:", err);
        process.exit(1);
      }
    });

  cmd
    .command("stop")
    .description("Stop the gateway server")
    .option("-p, --port <port>", "Port number", "18789")
    .option("-h, --host <host>", "Host address", "127.0.0.1")
    .action(async (options: { port: string; host: string }) => {
      const port = parseInt(options.port, 10);
      const host = options.host;

      try {
        // Check if gateway is running first
        const running = await isGatewayRunning(host, port);
        if (!running) {
          console.log(`Gateway is not running on ws://${host}:${port}`);
          return;
        }

        console.log(`Stopping gateway on ws://${host}:${port}...`);
        
        // Kill processes on the port
        await killPort(port);
        
        // Verify it's actually stopped
        let stopped = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const stillRunning = await isGatewayRunning(host, port);
          if (!stillRunning) {
            stopped = true;
            break;
          }
        }

        if (stopped) {
          console.log(`✓ Gateway stopped successfully`);
        } else {
          // Try one more time
          await killPort(port);
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const stillRunning = await isGatewayRunning(host, port);
          if (!stillRunning) {
            console.log(`✓ Gateway stopped after retry`);
          } else {
            console.error(`✗ Gateway is still running after stop attempt`);
            process.exit(1);
          }
        }
      } catch (err) {
        console.error("Failed to stop gateway:", err);
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Check gateway status")
    .option("--host <host>", "Gateway host", "127.0.0.1")
    .option("--port <port>", "Gateway port", "18789")
    .option("--json", "Output as JSON")
    .action(async (options: { host?: string; port?: string; json?: boolean }) => {
      const host = options.host ?? "127.0.0.1";
      const port = options.port ? parseInt(options.port, 10) : 18789;

      const running = await isGatewayRunning(host, port);
      if (!running) {
        if (shouldOutputJson(options)) {
          outputJson({ running: false, address: `ws://${host}:${port}` }, options);
        } else {
          console.log(`Gateway is not running on ws://${host}:${port}`);
        }
        return;
      }

      const client = new GatewayClient({ host, port });
      try {
        await client.connect();
        const response = await client.call({ method: "health" });

        if (response.ok && response.result) {
          const health = response.result as {
            status: string;
            version: string;
            uptime: number;
          };
          
          const statusData = {
            running: true,
            status: health.status,
            version: health.version,
            uptime: health.uptime,
            uptimeSeconds: Math.floor(health.uptime / 1000),
            address: `ws://${host}:${port}`,
          };

          if (shouldOutputJson(options)) {
            outputJson(statusData, options);
          } else {
            console.log("Gateway Status:");
            console.log(`  Status: ${health.status}`);
            console.log(`  Version: ${health.version}`);
            console.log(`  Uptime: ${Math.floor(health.uptime / 1000)}s`);
            console.log(`  Address: ws://${host}:${port}`);
          }
        } else {
          console.error("Failed to get status:", response.error?.message);
          process.exit(1);
        }

        client.disconnect();
      } catch (err) {
        client.disconnect();
        console.error("Error:", err instanceof Error ? err.message : "Unknown error");
        process.exit(1);
      }
    });

  return cmd;
}
