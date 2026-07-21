import { spawn, ChildProcess } from "child_process";
import type { ProgressEmitter } from "./events";

export const APP_PORT = 4100;
export const APP_URL = `http://localhost:${APP_PORT}`;

let current: ChildProcess | null = null;

/** Starts the generated app's dev server, replacing any previous one. */
export async function serveApp(
  appDir: string,
  emit: ProgressEmitter
): Promise<string> {
  if (current) {
    current.kill("SIGTERM");
    current = null;
  }

  emit("done", "Starting your app...");
  current = spawn("npm", ["run", "dev"], {
    cwd: appDir,
    stdio: ["ignore", "ignore", "ignore"],
    detached: false,
    env: { ...process.env },
  });

  const start = Date.now();
  while (Date.now() - start < 60000) {
    try {
      const res = await fetch(APP_URL);
      if (res.status < 500) {
        emit("done", `Your app is running at ${APP_URL}.`);
        return APP_URL;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Generated app did not start within 60s");
}
