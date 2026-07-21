import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import type { AnastasisProductSpec } from "../spec/schema";
import type { ProgressEmitter } from "./events";
import { verifyDeps } from "./verify-deps";
import { runCodex, resumeCodex } from "./codex-runner";
import { setRunStatus, addPendingQuestion, getOpenQuestion, answerQuestion } from "../db/client";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const TEMPLATE_DIR = path.join(REPO_ROOT, "template");
const AGENTS_MD_PATH = path.join(REPO_ROOT, "Agents.md");
const COPY_EXCLUDES = new Set(["node_modules", ".next", "data", ".git"]);

const CODEX_PROMPT = `Read AGENTS.md and spec/product-spec.json, then generate the resurrected application exactly as AGENTS.md instructs. Follow its workflow order: schema, migration, API routes, views, tests. You are done only when "npm run migrate" exits 0 with row counts matching the migration_plan and "npm run smoke" passes every test. If the spec is genuinely ambiguous in a way that blocks you, follow AGENTS.md's "Asking For Clarification" section instead of guessing.`;

export type BuildResult =
  | { status: "paused"; sessionId: string; question: string }
  | { status: "done"; appDir: string };

/** Recursively copies the template, skipping heavy/derived directories. */
function copyTemplate(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (COPY_EXCLUDES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTemplate(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/** Extracts the export ZIP's files into the app's import/ directory. */
async function unpackImport(zipPath: string, importDir: string): Promise<void> {
  fs.mkdirSync(importDir, { recursive: true });
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const target = path.join(importDir, path.basename(name));
    fs.writeFileSync(target, await entry.async("nodebuffer"));
  }
}

// A generated app's own code can hang (confirmed against a real run: a
// smoke test stuck in what looked like an unresolved retry/poll loop,
// leaving `next dev` + the test runner sitting at ~0% CPU indefinitely).
// Nothing bounded that before — one broken generated app could wedge a run
// forever. `detached: true` + killing the negative PID takes out the whole
// process group (npm -> node -> next dev and its children), not just the
// immediate child, since `child.kill()` alone leaves orphaned grandchildren
// running.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function run(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (line: string) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  extraEnv: Record<string, string> = {}
): Promise<{ code: number; output: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      // The orchestrator's own container runs with NODE_ENV=production
      // (correct for the orchestrator itself). Every generated app's
      // migrate/smoke run in dev mode (`next dev`, spawned inside
      // smoke.mjs) and inherits this env by default — confirmed against a
      // real run: with NODE_ENV=production leaking in, Next's dev server
      // silently only registers GET/HEAD on dynamic routes, 405ing every
      // PATCH/DELETE Codex correctly wrote. Force it back to development
      // for anything this pipeline spawns, unless a call site overrides it.
      env: { ...process.env, NODE_ENV: "development", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let timedOut = false;
    const handle = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) {
        for (const line of text.split("\n")) {
          if (line.trim()) onOutput(line.trim());
        }
      }
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);
    child.on("error", reject);

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, timeoutMs);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? 1 : code ?? 1, output, timedOut });
    });
  });
}

/** Prepares a fresh generated-app directory from the seed template + spec + import data. */
function prepareAppDir(spec: AnastasisProductSpec, runDir: string): string {
  const appDir = path.join(runDir, "app");
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true });
  copyTemplate(TEMPLATE_DIR, appDir);
  // Reuse the seed's pre-installed dependencies (the dependency set is fixed).
  fs.symlinkSync(
    path.join(TEMPLATE_DIR, "node_modules"),
    path.join(appDir, "node_modules"),
    "dir"
  );
  fs.copyFileSync(AGENTS_MD_PATH, path.join(appDir, "AGENTS.md"));

  fs.mkdirSync(path.join(appDir, "spec"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "spec", "product-spec.json"),
    JSON.stringify(spec, null, 2)
  );
  return appDir;
}

/** Independently verifies the dependency allow-list, migration, and smoke tests. */
async function finishBuild(
  spec: AnastasisProductSpec,
  appDir: string,
  emit: ProgressEmitter
): Promise<string> {
  emit("build", "Checking no dependencies were added...");
  verifyDeps(appDir, TEMPLATE_DIR);

  // Codex writing its own app/layout.tsx without importing globals.css means
  // next build emits zero CSS — the app works but renders as bare unstyled
  // HTML. Confirmed on the first real production resurrection: 412 tasks,
  // fully functional, Times New Roman. Status-200 smoke checks can't catch
  // "ugly", but this mechanical check catches the one omission that nukes
  // ALL styling.
  const layoutPath = path.join(appDir, "app", "layout.tsx");
  if (fs.existsSync(layoutPath) && !fs.readFileSync(layoutPath, "utf8").includes("globals.css")) {
    throw new Error(
      "Generated app/layout.tsx does not import globals.css — the app would render with no CSS at all."
    );
  }

  emit("build", "Verifying the migration...");
  const migrate = await run("npm", ["run", "migrate"], appDir);
  if (migrate.code !== 0) {
    const reason = migrate.timedOut ? "timed out" : "failed";
    throw new Error(`Migration verification ${reason}:\n${migrate.output.slice(-2000)}`);
  }
  for (const plan of spec.migration_plan) {
    if (!migrate.output.includes(String(plan.row_count_expected))) {
      emit(
        "build",
        `Warning: could not confirm ${plan.row_count_expected} rows for ${plan.entity} in migration log.`
      );
    }
  }

  emit("build", "Running the app's own tests...");
  // A unique port per run, not the seed's hardcoded default — this
  // container is reused across runs, and a leftover process (e.g. Codex
  // itself starting a background dev server during its own testing and
  // never stopping it — confirmed happening for real) would otherwise
  // collide with the next run's verification via EADDRINUSE.
  const smokePort = String(20000 + Math.floor(Math.random() * 20000));
  const smoke = await run(
    "npm",
    ["run", "smoke"],
    appDir,
    undefined,
    DEFAULT_TIMEOUT_MS,
    { SMOKE_PORT: smokePort }
  );
  if (smoke.code !== 0) {
    const reason = smoke.timedOut
      ? "timed out (the generated app likely has a hanging test — a real code-quality issue in this run's generation, not an infra problem)"
      : "failed";
    throw new Error(`Smoke tests ${reason}:\n${smoke.output.slice(-2000)}`);
  }

  emit("done", "All tests passed. Your app is ready.");
  return appDir;
}

/**
 * Copies the template into the run dir, provides the spec and import data,
 * runs Codex to generate the app, then independently verifies dependencies,
 * migrate, and smoke. If Codex pauses for clarification, returns a "paused"
 * result instead of throwing — the caller persists/surfaces the question and
 * calls resumeBuild once the user answers.
 */
export async function build(
  runId: string,
  spec: AnastasisProductSpec,
  zipPath: string,
  runDir: string,
  emit: ProgressEmitter
): Promise<BuildResult> {
  emit("build", "Preparing a fresh copy of the app template...");
  const appDir = prepareAppDir(spec, runDir);
  await unpackImport(zipPath, path.join(appDir, "import"));

  setRunStatus(runId, "building");
  emit("build", "Building your app (writing code, testing, fixing)...");
  const result = await runCodex(CODEX_PROMPT, appDir, emit);

  if (result.status === "needs_clarification") {
    if (!result.sessionId || !result.question) {
      throw new Error("Codex asked for clarification but returned no session id/question");
    }
    addPendingQuestion(runId, result.sessionId, result.question);
    setRunStatus(runId, "awaiting_input");
    emit("question", result.question, { runId, sessionId: result.sessionId, question: result.question });
    return { status: "paused", sessionId: result.sessionId, question: result.question };
  }

  const finishedAppDir = await finishBuild(spec, appDir, emit);
  return { status: "done", appDir: finishedAppDir };
}

/**
 * Resumes a paused build with the user's answer, looping through further
 * clarification round-trips if Codex asks again, until it's done.
 */
export async function resumeBuild(
  runId: string,
  answer: string,
  spec: AnastasisProductSpec,
  runDir: string,
  emit: ProgressEmitter
): Promise<BuildResult> {
  const openQuestion = getOpenQuestion(runId);
  if (!openQuestion) {
    throw new Error(`No pending question found for run ${runId}`);
  }
  answerQuestion(openQuestion.id, answer);

  const appDir = path.join(runDir, "app");
  setRunStatus(runId, "building");
  emit("build", "Continuing the build with your answer...");
  const result = await resumeCodex(openQuestion.session_id, answer, appDir, emit);

  if (result.status === "needs_clarification") {
    if (!result.sessionId || !result.question) {
      throw new Error("Codex asked for clarification but returned no session id/question");
    }
    addPendingQuestion(runId, result.sessionId, result.question);
    setRunStatus(runId, "awaiting_input");
    emit("question", result.question, { runId, sessionId: result.sessionId, question: result.question });
    return { status: "paused", sessionId: result.sessionId, question: result.question };
  }

  const finishedAppDir = await finishBuild(spec, appDir, emit);
  return { status: "done", appDir: finishedAppDir };
}
