import { serveApp } from "./serve";
import { buildAndDeploy } from "./deploy";
import type { ProgressEmitter } from "./events";

/**
 * Serves the finished app locally (a plain `npm run dev` subprocess) in
 * local development, or builds+deploys it to the real k8s cluster in
 * production. Switched by ANASTASIS_DEPLOY_TARGET so the same codebase
 * stays testable locally without a cluster.
 */
export async function finishRun(
  appDir: string,
  runId: string,
  emit: ProgressEmitter
): Promise<string> {
  if (process.env.ANASTASIS_DEPLOY_TARGET === "k8s") {
    return buildAndDeploy(appDir, runId, emit);
  }
  return serveApp(appDir, emit);
}
