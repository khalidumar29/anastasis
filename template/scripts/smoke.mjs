// FROZEN — do not edit. Boots the app, runs tests/smoke.test.ts against it,
// shuts the app down, and exits with the test runner's status.
import { spawn } from "child_process";
import path from "path";

const PORT = process.env.SMOKE_PORT ?? "4199";
const BASE_URL = `http://localhost:${PORT}`;
const root = process.cwd();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await wait(500);
  }
  throw new Error(`Server did not become ready at ${url}`);
}

// detached so the whole process group (npx -> next -> its own children) can
// be killed together — a plain server.kill() only signals the immediate
// child and can leave the actual dev server running, occupying this port
// for every future run sharing this container (confirmed against a real
// deployment: exactly this leaked a next-dev process that then blocked the
// next run with EADDRINUSE).
const server = spawn("npx", ["next", "dev", "-p", PORT], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
  detached: true,
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
// child.kill() failures surface asynchronously as an 'error' event, not a
// synchronous throw — an unhandled 'error' event crashes the process by
// default. Confirmed against a real run: the process-group kill below can
// legitimately fail (e.g. the group leader already exited on its own,
// including when Codex itself already stopped the server per its own
// process-hygiene instructions), and without this listener that failure
// took down the whole test runner instead of just being a no-op.
server.on("error", () => {});

function killServer() {
  if (server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
  }
}

try {
  await waitForServer(BASE_URL);
  const tests = spawn(
    "node",
    ["--import", "tsx", "--test", "tests/smoke.test.ts"],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, BASE_URL },
    }
  );
  const code = await new Promise((resolve) => tests.on("exit", resolve));
  process.exitCode = code ?? 1;
} finally {
  killServer();
}
