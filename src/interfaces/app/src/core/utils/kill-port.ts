import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Kill processes listening on a specific port
 */
export async function killPort(port: number): Promise<void> {
  const platform = process.platform;

  try {
    if (platform === "darwin" || platform === "linux") {
      // Find process using the port (TCP only, listening state)
      // Use -iTCP -sTCP:LISTEN to only get processes actually listening on TCP
      const { stdout } = await execAsync(`lsof -tiTCP:${port} -sTCP:LISTEN`);
      const pids = stdout.trim().split("\n").filter(Boolean);

      if (pids.length === 0) {
        return; // No process found
      }

      console.log(`[Kill Port] Found ${pids.length} process(es) on port ${port}: ${pids.join(", ")}`);

      // Kill all processes
      for (const pid of pids) {
        try {
          await execAsync(`kill -9 ${pid}`);
          console.log(`[Kill Port] Killed process ${pid} on port ${port}`);
        } catch (err) {
          // Process might have already terminated
          console.warn(`[Kill Port] Failed to kill process ${pid}:`, err);
        }
      }

      // Wait a moment for processes to actually terminate
      await new Promise((resolve) => setTimeout(resolve, 200));
    } else if (platform === "win32") {
      // Windows: Find and kill process using the port
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split("\n");
      const pids = new Set<string>();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          pids.add(pid);
        }
      }

      if (pids.size === 0) {
        return; // No process found
      }

      console.log(`[Kill Port] Found ${pids.size} process(es) on port ${port}`);

      for (const pid of pids) {
        try {
          await execAsync(`taskkill /PID ${pid} /F`);
          console.log(`[Kill Port] Killed process ${pid} on port ${port}`);
        } catch (err) {
          // Process might have already terminated
          console.warn(`[Kill Port] Failed to kill process ${pid}:`, err);
        }
      }

      // Wait a moment for processes to actually terminate
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (err: any) {
    // If lsof/netstat returns no results (exit code 1), that's okay
    if (err.code === 1 || err.message?.includes("No such process")) {
      return; // No process found
    }
    // Other errors should be logged
    console.warn(`[Kill Port] Error killing processes on port ${port}:`, err.message || err);
  }
}
