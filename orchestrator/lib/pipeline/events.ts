export type PipelineStage =
  | "frames"
  | "watch"
  | "understand"
  | "match"
  | "build"
  | "question"
  | "done"
  | "error";

export type QuestionPayload = {
  runId: string;
  sessionId: string;
  question: string;
};

export type ProgressEvent = {
  stage: PipelineStage;
  message: string;
  timestamp: string;
  question?: QuestionPayload;
};

export type ProgressEmitter = (
  stage: PipelineStage,
  message: string,
  question?: QuestionPayload
) => void;

export function makeConsoleEmitter(): ProgressEmitter {
  return (stage, message, question) => {
    process.stdout.write(`[${stage}] ${message}\n`);
    if (question) {
      process.stdout.write(`  -> awaiting answer for run ${question.runId}\n`);
    }
  };
}
