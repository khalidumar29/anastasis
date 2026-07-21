import { NextRequest } from "next/server";
import { subscribe } from "@/lib/pipeline/run-bus";
import { getRun, getOpenQuestion } from "@/lib/db/client";
import { userIdFromCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const TERMINAL_STATUSES = new Set(["ready", "failed"]);

/**
 * Lets the client (re)connect to an existing run's progress — needed
 * because a run paused for clarification can't keep the original POST's
 * stream open indefinitely waiting on a human to type an answer.
 */
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const userId = userIdFromCookieHeader(req.headers.get("cookie"));
  if (!userId) {
    return Response.json({ error: "Not logged in." }, { status: 401 });
  }

  const { runId } = params;
  const run = getRun(runId);
  if (!run) {
    return Response.json({ error: `No run found for ${runId}` }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (payload: object) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Snapshot so a reconnect (e.g. a page reload) still sees where things
      // stand, even if it missed the live event.
      if (run.status === "awaiting_input") {
        const openQuestion = getOpenQuestion(runId);
        if (openQuestion) {
          send({
            runId,
            stage: "question",
            message: openQuestion.question,
            question: {
              runId,
              sessionId: openQuestion.session_id,
              question: openQuestion.question,
            },
            timestamp: openQuestion.created_at,
          });
        }
      } else if (run.status === "ready") {
        send({
          runId,
          stage: "done",
          message: "READY",
          url: run.app_url,
          timestamp: run.updated_at,
        });
      } else if (run.status === "failed") {
        send({
          runId,
          stage: "error",
          message: run.error ?? "Build failed",
          timestamp: run.updated_at,
        });
      }

      if (TERMINAL_STATUSES.has(run.status)) {
        closed = true;
        controller.close();
        return;
      }

      const unsubscribe = subscribe(runId, (event) => send(event));
      // See /api/resurrect/route.ts's heartbeat comment for why: a quiet
      // stretch (e.g. Codex working with no emitted progress line) can
      // otherwise get this connection dropped by an idle-timeout proxy.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          closed = true;
        }
      }, 20000);
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", stop);
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
