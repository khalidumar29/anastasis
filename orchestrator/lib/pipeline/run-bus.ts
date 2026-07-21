import { EventEmitter } from "events";
import type { ProgressEvent } from "./events";

// In-process pub/sub keyed by run id, so a build paused for clarification in
// one HTTP request's lifecycle can still deliver progress to a browser tab
// that reconnects later (via [runId]/stream) after the answer is submitted
// from a separate request. Single-process only — the real deployment's
// multi-instance story goes through the DB instead (see Phase 4/5 infra).
const buses = new Map<string, EventEmitter>();

function busFor(runId: string): EventEmitter {
  let bus = buses.get(runId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(50);
    buses.set(runId, bus);
  }
  return bus;
}

export function publish(runId: string, event: ProgressEvent): void {
  busFor(runId).emit("event", event);
}

/** Subscribes to a run's events; returns an unsubscribe function. */
export function subscribe(runId: string, listener: (event: ProgressEvent) => void): () => void {
  const bus = busFor(runId);
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

export function closeRun(runId: string): void {
  buses.delete(runId);
}
