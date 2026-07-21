import { spawn } from "child_process";
import path from "path";
import type { ProgressEmitter } from "./events";

// Verified against a real `codex exec --json --output-schema` run:
// - `{"type":"thread.started","thread_id":"<uuid>"}` carries the session id
//   needed for `codex exec resume`.
// - The final structured response arrives as
//   `{"type":"item.completed","item":{"type":"agent_message","text":"<json string>"}}`,
//   where `text` is a JSON-encoded string matching codex-schema.json.
// - `--output-schema` requires a flat object schema — a top-level `oneOf`
//   is rejected by the API ("'oneOf' is not permitted").
// - stdout carries pure JSONL; unrelated MCP/auth diagnostic noise goes to
//   stderr, not stdout.
const CODEX_SCHEMA_PATH = path.join(process.cwd(), "lib", "pipeline", "codex-schema.json");
// Codex's own internal sandbox (bubblewrap, on Linux) needs to create a
// nested mount namespace, which fails inside a k8s pod's default security
// context ("bwrap: Failed to make / slave: Permission denied" — confirmed
// against the real deployment, not a guess). "danger-full-access" skips
// bubblewrap entirely; the pod's own container boundary is the isolation
// layer instead there. Local dev keeps the real sandbox, since bubblewrap
// works fine outside a container.
const CODEX_SANDBOX_MODE = process.env.ANASTASIS_CODEX_SANDBOX ?? "workspace-write";

export type CodexStatus = "done" | "needs_clarification";

export type CodexResult = {
  sessionId: string | null;
  status: CodexStatus | null;
  question: string | null;
};

type CodexItem = {
  type?: string;
  text?: string;
  command?: string;
  path?: string;
  [key: string]: unknown;
};

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Best-effort human-readable summary of an item.completed event's payload. */
function describeItem(item: CodexItem): string | null {
  switch (item.type) {
    case "reasoning":
    case "agent_message":
      return typeof item.text === "string" ? truncate(item.text) : null;
    case "command_execution":
      return item.command ? `Running: ${truncate(item.command, 120)}` : null;
    case "file_change":
      return item.path ? `Editing ${item.path}` : null;
    default:
      return null;
  }
}

/** Parses an agent_message's text as the schema-constrained final response, if it is one. */
function tryParseStructured(
  text: string
): { status: CodexStatus; question: string | null } | null {
  try {
    const obj = JSON.parse(text);
    if (obj && (obj.status === "done" || obj.status === "needs_clarification")) {
      return { status: obj.status, question: obj.question ?? null };
    }
  } catch {
    // not the structured final message — just a normal narration line
  }
  return null;
}

function parseJsonl(
  jsonl: string,
  emit: ProgressEmitter
): CodexResult & { error: string | null } {
  let sessionId: string | null = null;
  let status: CodexStatus | null = null;
  let question: string | null = null;
  let error: string | null = null;

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // not JSON — ignore stray output
    }

    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      sessionId = event.thread_id;
    } else if (event.type === "item.completed" && event.item) {
      const item = event.item as CodexItem;
      if (item.type === "agent_message" && typeof item.text === "string") {
        const structured = tryParseStructured(item.text);
        if (structured) {
          status = structured.status;
          question = structured.question;
          continue;
        }
      }
      const desc = describeItem(item);
      if (desc) emit("build", desc);
    } else if (event.type === "turn.failed" || event.type === "error") {
      error = event.error?.message ?? event.message ?? "Codex reported an error";
    }
  }

  return { sessionId, status, question, error };
}

// Confirmed against a real deployment: running with danger-full-access (see
// above), Codex will sometimes start its own background dev server as part
// of its own testing (e.g. `npm run dev &`) and never stop it before ending
// its turn — codex the process exits, but a plain bash `&` background job
// isn't in a new process group, so it survives as long as something is
// still around to be its parent. Left unchecked, these accumulate across
// runs in this same long-lived container and hit real limits: two
// generations' worth of stray `next dev` instances were enough to OOM-kill
// the whole orchestrator pod. `detached: true` + killing the negative PID
// after codex exits takes the whole group down, including anything it
// backgrounded.
function spawnCodex(
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd,
      // Codex's own shell inherits this container's env by default,
      // including NODE_ENV=production (correct for the orchestrator
      // itself). Codex self-tests generated apps with `next dev`, and
      // NODE_ENV=production leaking into a dev server silently breaks
      // non-GET methods on dynamic routes (see build.ts's run() for the
      // full story) — meaning Codex has been debugging against a false
      // signal in its own sandbox on every build. Force development here
      // too so what Codex sees locally matches what our own verification
      // gate sees.
      env: { ...process.env, NODE_ENV: "development" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // group already gone — fine
        }
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Starts a fresh Codex session with the given prompt in appDir. */
export async function runCodex(
  prompt: string,
  appDir: string,
  emit: ProgressEmitter
): Promise<CodexResult> {
  const { code, stdout, stderr } = await spawnCodex(
    [
      "exec",
      "--json",
      "--output-schema",
      CODEX_SCHEMA_PATH,
      "--sandbox",
      CODEX_SANDBOX_MODE,
      "--skip-git-repo-check",
      "-C",
      appDir,
      prompt,
    ],
    appDir
  );
  const { sessionId, status, question, error } = parseJsonl(stdout, emit);
  if (error) throw new Error(`Codex reported an error: ${error}`);
  if (code !== 0) throw new Error(`Codex exited with code ${code}:\n${stderr.slice(-2000)}`);
  return { sessionId, status, question };
}

/** Resumes a previously paused Codex session with the user's answer. */
export async function resumeCodex(
  sessionId: string,
  answer: string,
  appDir: string,
  emit: ProgressEmitter
): Promise<CodexResult> {
  // `codex exec resume` has no `-s/--sandbox` flag at all (confirmed via
  // --help) — it silently falls back to a sandboxed default that needs
  // bubblewrap, regardless of what the original session used. Confirmed
  // against a real deployment: the initial `codex exec` correctly ran with
  // danger-full-access and worked, but the very first resume of that same
  // session hit "bwrap: Failed to make / slave: Permission denied" anyway.
  // `--dangerously-bypass-approvals-and-sandbox` is resume's actual
  // equivalent of `-s danger-full-access`.
  const bypassSandboxArgs =
    CODEX_SANDBOX_MODE === "danger-full-access"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : [];
  const { code, stdout, stderr } = await spawnCodex(
    [
      "exec",
      "resume",
      sessionId,
      "--json",
      "--output-schema",
      CODEX_SCHEMA_PATH,
      ...bypassSandboxArgs,
      "--skip-git-repo-check",
      answer,
    ],
    appDir
  );
  const { sessionId: continuedSessionId, status, question, error } = parseJsonl(stdout, emit);
  if (error) throw new Error(`Codex reported an error: ${error}`);
  if (code !== 0) throw new Error(`Codex exited with code ${code}:\n${stderr.slice(-2000)}`);
  return { sessionId: continuedSessionId ?? sessionId, status, question };
}
