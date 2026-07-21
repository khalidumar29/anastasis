import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// gpt-5.6-sol handles both the vision (frame-watching) and reasoning
// (spec-building) stages — verified against the real API, including image
// input support. Same family Codex runs on (see orchestrator Dockerfile
// entrypoint), so the whole pipeline is GPT-5.6 end to end.
export const VISION_MODEL = process.env.ANASTASIS_VISION_MODEL ?? "gpt-5.6-sol";
export const REASONING_MODEL =
  process.env.ANASTASIS_REASONING_MODEL ?? "gpt-5.6-sol";
