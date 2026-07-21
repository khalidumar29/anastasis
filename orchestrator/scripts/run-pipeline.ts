import path from "path";
import fs from "fs";
import { extractFrames } from "../lib/pipeline/frames";
import { watchFrames } from "../lib/pipeline/watch";
import { understand } from "../lib/pipeline/understand";
import { match } from "../lib/pipeline/match";
import { build } from "../lib/pipeline/build";
import { makeConsoleEmitter } from "../lib/pipeline/events";
import { createRun } from "../lib/db/client";

/**
 * CLI test harness for the pipeline: frames -> watch -> understand [-> match].
 * Usage: npm run pipeline -- <video-path> [export-zip-path] [run-id]
 */
async function main() {
  const videoPath = process.argv[2];
  if (!videoPath) {
    console.error("Usage: npm run pipeline -- <video-path> [export-zip-path] [run-id]");
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set");
    process.exit(1);
  }

  const zipPath = process.argv[3];
  const runId = process.argv[4] ?? `run-${Date.now()}`;
  const runDir = path.join(process.cwd(), "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const emit = makeConsoleEmitter();

  const frames = await extractFrames(
    path.resolve(videoPath),
    path.join(runDir, "frames"),
    emit
  );

  const notes = await watchFrames(frames, emit);
  fs.writeFileSync(path.join(runDir, "observations.md"), notes);

  const draftSpec = await understand(notes, emit);
  fs.writeFileSync(
    path.join(runDir, "draft-spec.json"),
    JSON.stringify(draftSpec, null, 2)
  );
  console.log(`\nDraft spec written to ${path.join(runDir, "draft-spec.json")}`);

  if (zipPath) {
    const finalSpec = await match(draftSpec, path.resolve(zipPath), emit);
    fs.writeFileSync(
      path.join(runDir, "product-spec.json"),
      JSON.stringify(finalSpec, null, 2)
    );
    console.log(`Final spec written to ${path.join(runDir, "product-spec.json")}`);

    createRun(runId);
    const result = await build(runId, finalSpec, path.resolve(zipPath), runDir, emit);
    if (result.status === "paused") {
      console.log(
        `\nCodex paused for clarification: "${result.question}"\n` +
          `Resume with: npm run build:app -- ${runId} ${zipPath} --answer "<your answer>"`
      );
      return;
    }
    console.log(`\nResurrected app at ${result.appDir} — run: cd ${result.appDir} && npm run dev`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
