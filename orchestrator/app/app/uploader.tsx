"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type LogEntry = {
  stage: string;
  message: string;
};

type QuestionState = {
  runId: string;
  question: string;
};

const STAGE_LABELS: Record<string, string> = {
  frames: "Watching",
  watch: "Watching",
  understand: "Understanding",
  match: "Matching your data",
  build: "Rebuilding",
  question: "Question",
  done: "Done",
  error: "Problem",
};

export default function Uploader() {
  const router = useRouter();
  const [video, setVideo] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionState | null>(null);
  const [answer, setAnswer] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  const appendLog = (entry: LogEntry) => {
    setLog((prev) => [...prev, entry]);
    requestAnimationFrame(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    });
  };

  const handlePayload = (payload: any) => {
    if (payload.stage === "error") {
      setError(payload.message);
      setRunning(false);
      setPendingQuestion(null);
    } else if (payload.stage === "question") {
      setPendingQuestion({ runId: payload.runId, question: payload.message });
      setRunning(false);
      appendLog(payload);
    } else if (payload.message === "READY" && payload.url) {
      setAppUrl(payload.url);
      setRunning(false);
      setPendingQuestion(null);
      router.refresh(); // refresh the server-rendered history list
    } else {
      appendLog(payload);
    }
  };

  const watchStream = (runId: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/resurrect/${runId}/stream`);
    eventSourceRef.current = es;
    es.onmessage = (event) => handlePayload(JSON.parse(event.data));
    es.onerror = () => es.close();
  };

  const resurrect = async () => {
    if (!video || !zip || running) return;
    setRunning(true);
    setLog([]);
    setAppUrl(null);
    setError(null);
    setPendingQuestion(null);

    const form = new FormData();
    form.append("video", video);
    form.append("zip", zip);

    try {
      const res = await fetch("/api/resurrect", { method: "POST", body: form });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok || !res.body) {
        throw new Error(`Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          // SSE comment lines (heartbeats, `: keepalive`) aren't prefixed
          // with "data: " — the native EventSource API skips these
          // automatically, but this is a hand-rolled parser (needed here
          // since the initial POST's streamed body isn't an EventSource),
          // so it has to skip them explicitly. Confirmed against a real
          // browser session: without this check, a heartbeat line reached
          // JSON.parse() as literal text and crashed the whole upload.
          if (!event.startsWith("data: ")) continue;
          const line = event.slice("data: ".length).trim();
          if (!line) continue;
          handlePayload(JSON.parse(line));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  const submitAnswer = async () => {
    if (!pendingQuestion || !answer.trim() || submittingAnswer) return;
    setSubmittingAnswer(true);
    try {
      const res = await fetch("/api/resurrect/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: pendingQuestion.runId, answer }),
      });
      if (!res.ok) {
        throw new Error(`Failed to submit answer (${res.status})`);
      }
      const runId = pendingQuestion.runId;
      setPendingQuestion(null);
      setAnswer("");
      setRunning(true);
      watchStream(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingAnswer(false);
    }
  };

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FilePick
          label="Screen recording"
          hint="A video of you using the old app"
          accept="video/*"
          file={video}
          onPick={setVideo}
          disabled={running}
        />
        <FilePick
          label="Data export"
          hint="The ZIP the old app let you download"
          accept=".zip"
          file={zip}
          onPick={setZip}
          disabled={running}
        />
      </div>

      <button
        onClick={resurrect}
        disabled={!video || !zip || running}
        className="mt-6 w-full rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
      >
        {running ? "Resurrecting..." : "Resurrect my app"}
      </button>

      {(log.length > 0 || error) && (
        <div
          ref={logRef}
          className="mt-8 max-h-96 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs leading-relaxed"
        >
          {log.map((entry, i) => (
            <p key={i} className="text-slate-300">
              <span className="mr-2 text-indigo-400">
                [{STAGE_LABELS[entry.stage] ?? entry.stage}]
              </span>
              {entry.message}
            </p>
          ))}
          {error && <p className="mt-2 text-rose-400">{error}</p>}
        </div>
      )}

      {pendingQuestion && (
        <div className="mt-6 rounded-lg border border-amber-500/60 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">{pendingQuestion.question}</p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
              placeholder="Type your answer..."
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
              autoFocus
            />
            <button
              onClick={submitAnswer}
              disabled={!answer.trim() || submittingAnswer}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {submittingAnswer ? "Sending..." : "Answer"}
            </button>
          </div>
        </div>
      )}

      {appUrl && (
        <a
          href={appUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 block rounded-lg bg-emerald-500 px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-emerald-400"
        >
          Open your app →
        </a>
      )}
    </div>
  );
}

function FilePick({
  label,
  hint,
  accept,
  file,
  onPick,
  disabled,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <label
      className={`block cursor-pointer rounded-lg border border-dashed p-4 transition-colors ${
        file
          ? "border-emerald-500/60 bg-emerald-500/5"
          : "border-slate-700 hover:border-slate-500"
      } ${disabled ? "pointer-events-none opacity-60" : ""}`}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="mt-1 block text-xs text-slate-400">
        {file ? file.name : hint}
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
