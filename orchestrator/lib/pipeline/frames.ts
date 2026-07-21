import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import type { ProgressEmitter } from "./events";

const execFileAsync = promisify(execFile);

const MAX_FRAMES = 40;

/**
 * Extracts frames from a screen recording at ~1 fps using ffmpeg,
 * then thins the set down to MAX_FRAMES by dropping near-identical
 * neighbors (cheap byte-size delta heuristic).
 * Returns absolute paths to the kept frames, in chronological order.
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  emit: ProgressEmitter
): Promise<string[]> {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  emit("frames", "Extracting frames from your recording...");
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vf",
    "fps=1,scale=1280:-2",
    "-q:v",
    "4",
    path.join(outDir, "frame-%04d.jpg"),
  ]);

  const all = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(outDir, f));

  const kept = dedupeBySizeDelta(all);
  const thinned = thinToMax(kept, MAX_FRAMES);

  emit(
    "frames",
    `Captured ${all.length} frames, kept ${thinned.length} distinct moments.`
  );
  return thinned;
}

/** Drops a frame when its file size is within 1% of the previous kept frame. */
function dedupeBySizeDelta(frames: string[]): string[] {
  const kept: string[] = [];
  let lastSize = -1;
  for (const frame of frames) {
    const size = fs.statSync(frame).size;
    if (lastSize < 0 || Math.abs(size - lastSize) / lastSize > 0.01) {
      kept.push(frame);
      lastSize = size;
    }
  }
  return kept;
}

/** Evenly samples down to max frames, always keeping first and last. */
function thinToMax(frames: string[], max: number): string[] {
  if (frames.length <= max) return frames;
  const result: string[] = [];
  const step = (frames.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    result.push(frames[Math.round(i * step)]);
  }
  return Array.from(new Set(result));
}
