import { NextRequest } from "next/server";
import path from "path";
import fs from "fs";
import { extractFrames } from "@/lib/pipeline/frames";
import { watchFrames } from "@/lib/pipeline/watch";
import { understand } from "@/lib/pipeline/understand";
import { match } from "@/lib/pipeline/match";
import { build } from "@/lib/pipeline/build";
import { finishRun } from "@/lib/pipeline/finish-run";
import type { PipelineStage, QuestionPayload } from "@/lib/pipeline/events";
import { publish, closeRun } from "@/lib/pipeline/run-bus";
import { createRun, setRunStatus } from "@/lib/db/client";
import { userIdFromCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function POST(req: NextRequest) {
  const userId = userIdFromCookieHeader(req.headers.get("cookie"));
  if (!userId) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  const form = await req.formData();
  const video = form.get("video");
  const zip = form.get("zip");
  if (!(video instanceof File) || !(zip instanceof File)) {
    return new Response(
      JSON.stringify({ error: "Both a screen recording and an export ZIP are required." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const runId = `run-${Date.now()}`;
  const runDir = path.join(process.cwd(), "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  createRun(runId, userId);

  const videoPath = path.join(runDir, video.name);
  const zipPath = path.join(runDir, zip.name);
  fs.writeFileSync(videoPath, Buffer.from(await video.arrayBuffer()));
  fs.writeFileSync(zipPath, Buffer.from(await zip.arrayBuffer()));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // The pipeline itself must survive the client going away (browser
      // tab closed, network hiccup, an intermediary proxy's idle-connection
      // timeout — Cloudflare in particular will drop a quiet SSE connection
      // after ~100s, and Codex can easily go that long between emitted
      // progress lines while it's heads-down writing code). Losing the
      // *stream* is fine — that's exactly what the run-bus + reconnect
      // endpoint exist for — but a failed `send()` must never abort the
      // actual frames→watch→understand→match→build→deploy chain. This was
      // a real bug caught by a live test, not a hypothetical: the first
      // attempt at this exact scenario surfaced "Invalid state: Controller
      // is already closed" and killed the whole run.
      let closed = false;
      const send = (payload: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // Sends to this request's own SSE stream AND to the run-bus, so a
      // second tab (or a reconnect after a pause) also sees it.
      const announce = (payload: { stage: PipelineStage; message: string; [k: string]: unknown }) => {
        const full = { runId, timestamp: new Date().toISOString(), ...payload };
        send(full);
        publish(runId, full as any);
      };
      const emit = (stage: PipelineStage, message: string, question?: QuestionPayload) => {
        announce({ stage, message, question });
      };

      req.signal.addEventListener("abort", () => {
        closed = true;
      });
      // Keeps the connection from going idle long enough for a proxy to
      // drop it during a long quiet stretch (e.g. Codex working with no
      // emitted progress line for a while). SSE comments (":" prefix) are
      // invisible to EventSource listeners.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          closed = true;
        }
      }, 20000);

      try {
        const frames = await extractFrames(
          videoPath,
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

        const finalSpec = await match(draftSpec, zipPath, emit);
        fs.writeFileSync(
          path.join(runDir, "product-spec.json"),
          JSON.stringify(finalSpec, null, 2)
        );

        const result = await build(runId, finalSpec, zipPath, runDir, emit);

        if (result.status === "paused") {
          // build() already emitted the "question" event. Nothing more to
          // stream until the user answers via /api/resurrect/answer — the
          // client reconnects to /api/resurrect/[runId]/stream to keep
          // watching once it does.
          return;
        }

        const url = await finishRun(result.appDir, runId, emit);
        setRunStatus(runId, "ready", { appUrl: url });
        announce({ stage: "done", message: "READY", url });
        closeRun(runId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRunStatus(runId, "failed", { error: message });
        announce({ stage: "error", message });
        closeRun(runId);
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed — fine
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
