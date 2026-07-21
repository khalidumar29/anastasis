import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import { resumeBuild } from "@/lib/pipeline/build";
import { finishRun } from "@/lib/pipeline/finish-run";
import { AnastasisProductSpec } from "@/lib/spec/schema";
import type { PipelineStage, QuestionPayload } from "@/lib/pipeline/events";
import { publish, closeRun } from "@/lib/pipeline/run-bus";
import { setRunStatus, getRun } from "@/lib/db/client";
import { userIdFromCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/**
 * Submits the user's answer to a paused build and resumes it in the
 * background. The client watches progress via
 * /api/resurrect/[runId]/stream rather than this response, since resuming
 * (another Codex turn, then migrate/smoke) can take a while.
 */
export async function POST(req: NextRequest) {
  const userId = userIdFromCookieHeader(req.headers.get("cookie"));
  if (!userId) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const runId = body?.runId;
  const answer = body?.answer;
  if (typeof runId !== "string" || typeof answer !== "string" || !answer.trim()) {
    return Response.json(
      { error: "runId and a non-empty answer are required." },
      { status: 400 }
    );
  }

  const run = getRun(runId);
  if (!run) {
    return Response.json({ error: `No run found for ${runId}` }, { status: 404 });
  }

  const runDir = path.join(process.cwd(), "runs", runId);
  const specPath = path.join(runDir, "product-spec.json");
  if (!fs.existsSync(specPath)) {
    return Response.json({ error: `No product spec found for run ${runId}` }, { status: 404 });
  }
  const spec = AnastasisProductSpec.parse(JSON.parse(fs.readFileSync(specPath, "utf8")));

  const emit = (stage: PipelineStage, message: string, question?: QuestionPayload) => {
    publish(runId, { runId, stage, message, question, timestamp: new Date().toISOString() } as any);
  };

  void (async () => {
    try {
      const result = await resumeBuild(runId, answer, spec, runDir, emit);
      if (result.status === "done") {
        const url = await finishRun(result.appDir, runId, emit);
        setRunStatus(runId, "ready", { appUrl: url });
        publish(runId, {
          runId,
          stage: "done",
          message: "READY",
          url,
          timestamp: new Date().toISOString(),
        } as any);
        closeRun(runId);
      }
      // If paused again, resumeBuild already published the new question event.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRunStatus(runId, "failed", { error: message });
      publish(runId, { runId, stage: "error", message, timestamp: new Date().toISOString() } as any);
      closeRun(runId);
    }
  })();

  return Response.json({ ok: true });
}
