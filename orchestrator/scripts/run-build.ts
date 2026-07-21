import path from "path";
import fs from "fs";
import { build, resumeBuild } from "../lib/pipeline/build";
import { AnastasisProductSpec } from "../lib/spec/schema";
import { makeConsoleEmitter } from "../lib/pipeline/events";
import { createRun, getRun, setRunStatus } from "../lib/db/client";
import { finishRun } from "../lib/pipeline/finish-run";

/**
 * Build-only runner: resumes from a saved product-spec.json without
 * re-running the vision/reasoning stages.
 * Usage: npm run build:app -- <run-id> <export-zip-path> [--answer "<answer>"]
 */
async function main() {
  const runId = process.argv[2];
  const zipPath = process.argv[3];
  const answerFlagIndex = process.argv.indexOf("--answer");
  const answer = answerFlagIndex !== -1 ? process.argv[answerFlagIndex + 1] : undefined;

  if (!runId || !zipPath) {
    console.error('Usage: npm run build:app -- <run-id> <export-zip-path> [--answer "<answer>"]');
    process.exit(1);
  }

  const runDir = path.join(process.cwd(), "runs", runId);
  const specPath = path.join(runDir, "product-spec.json");
  if (!fs.existsSync(specPath)) {
    console.error(`No product-spec.json found at ${specPath}`);
    process.exit(1);
  }

  const spec = AnastasisProductSpec.parse(
    JSON.parse(fs.readFileSync(specPath, "utf8"))
  );
  const emit = makeConsoleEmitter();

  const result = answer
    ? await resumeBuild(runId, answer, spec, runDir, emit)
    : await (async () => {
        if (!getRun(runId)) createRun(runId);
        return build(runId, spec, path.resolve(zipPath), runDir, emit);
      })();

  if (result.status === "paused") {
    console.log(
      `\nCodex paused for clarification: "${result.question}"\n` +
        `Resume with: npm run build:app -- ${runId} ${zipPath} --answer "<your answer>"`
    );
    return;
  }

  // Same finishing step route.ts uses: serves locally (serve.ts) or
  // builds+deploys to the real cluster (deploy.ts), based on
  // ANASTASIS_DEPLOY_TARGET — so this script actually exercises the full
  // path, not just the Codex generation step.
  const url = await finishRun(result.appDir, runId, emit);
  setRunStatus(runId, "ready", { appUrl: url });
  console.log(`\nYour app is ready at ${url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
