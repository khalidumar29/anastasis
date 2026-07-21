import * as k8s from "@kubernetes/client-node";
import fs from "fs";
import path from "path";
import type { ProgressEmitter } from "./events";

// Cluster topology as actually bootstrapped on the real VPS (see
// infra/runbook-phase1.md) — this diverged from the original design once
// the box turned out to already run other live sites behind nginx:
// - k3s installed with --disable=traefik --disable=servicelb (both would
//   have grabbed ports 80/443, colliding with the existing nginx). Ingress
//   is ingress-nginx instead, exposed on fixed NodePorts 30080/30443 that
//   never touch 80/443, declared in infra/terraform/cluster.tf.
// - The existing host nginx (unchanged for its other sites) gets one new
//   server block (infra/nginx/anastasis.conf) proxying anastasis.app and
//   *.anastasis.app to the ingress-nginx NodePort.
// - TLS terminates at Cloudflare (Flexible SSL) — the hop from Cloudflare to
//   this origin is plain HTTP, so there is no cert-manager, no
//   ClusterIssuer, and no per-tenant TLS Secret to worry about; every
//   Ingress below is plain HTTP with ingressClassName "nginx".
// - The orchestrator itself runs as a Deployment inside the cluster (Phase 1
//   infra/terraform/orchestrator.tf), not on a separate machine, so it and
//   each Kaniko build Job can share a PVC for the build context — Kaniko has
//   no other way to see files that only exist on the orchestrator's own disk.
// - Images push to the in-cluster registry (registry:2, ClusterIP-only,
//   containerd configured to trust it as insecure/plain-http — see
//   infra/terraform/registry.tf).
// - One Namespace per tenant app (`tenant-<runId>`) for basic isolation.
//   NetworkPolicy to actually block cross-tenant traffic is a Phase 5+
//   hardening item, not automatic just from separate namespaces.

const SHARED_BUILD_ROOT = process.env.ANASTASIS_BUILD_ROOT ?? "/var/anastasis/builds";
const REGISTRY_HOST = process.env.ANASTASIS_REGISTRY_HOST ?? "registry.kube-system.svc.cluster.local:5000";
const BASE_DOMAIN = process.env.ANASTASIS_BASE_DOMAIN ?? "anastasis.app";
const KANIKO_IMAGE = "gcr.io/kaniko-project/executor:latest";

function kubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault(); // in-cluster config when running as a Pod; kubeconfig file otherwise
  return kc;
}

/**
 * Copies the generated app directory onto the shared build-context volume.
 * Excludes node_modules: in appDir it's a symlink into the seed template
 * (see build.ts's copyTemplate), which would land on the PVC as a dangling
 * symlink (the seed template itself isn't copied here) — copying it as-is
 * would silently clobber the real node_modules the Dockerfile's `deps`
 * stage installs fresh via `npm ci`, once `COPY . .` in the `builder` stage
 * copies this context over it.
 */
function stageBuildContext(appDir: string, runId: string): string {
  const contextDir = path.join(SHARED_BUILD_ROOT, runId);
  fs.mkdirSync(contextDir, { recursive: true });
  fs.cpSync(appDir, contextDir, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes("node_modules"),
  });
  return contextDir;
}

/** Creates a Kaniko Job to build the app's Dockerfile and push it to the in-cluster registry. */
async function buildImage(
  batchApi: k8s.BatchV1Api,
  runId: string,
  contextDir: string,
  emit: ProgressEmitter
): Promise<string> {
  const imageTag = `${REGISTRY_HOST}/anastasis-apps/${runId}:${Date.now()}`;
  const jobName = `build-${runId}`;

  emit("build", `Building container image ${imageTag}...`);
  await batchApi.createNamespacedJob({
    namespace: "default",
    body: {
      metadata: { name: jobName },
      spec: {
        backoffLimit: 0,
        template: {
          spec: {
            restartPolicy: "Never",
            // local-path PVs are node-local — anastasis-build-root is
            // bound to whichever node the orchestrator (its other
            // consumer) runs on, so this Job must land on the same node
            // or the mount fails outright. Confirmed against the real
            // 2-node cluster: the PVC bound to VPS2 once the orchestrator
            // moved there.
            nodeSelector: { "anastasis-role": "build" },
            containers: [
              {
                name: "kaniko",
                image: KANIKO_IMAGE,
                args: [
                  `--context=dir://${contextDir}`,
                  "--dockerfile=Dockerfile",
                  `--destination=${imageTag}`,
                  "--insecure",
                  "--skip-tls-verify",
                ],
                volumeMounts: [{ name: "build-root", mountPath: SHARED_BUILD_ROOT }],
              },
            ],
            volumes: [
              {
                name: "build-root",
                persistentVolumeClaim: { claimName: "anastasis-build-root" },
              },
            ],
          },
        },
      },
    },
  });

  await waitForJob(batchApi, "default", jobName, emit);
  return imageTag;
}

async function waitForJob(
  batchApi: k8s.BatchV1Api,
  namespace: string,
  jobName: string,
  emit: ProgressEmitter,
  timeoutMs = 10 * 60 * 1000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await batchApi.readNamespacedJobStatus({ name: jobName, namespace });
    const status = job.status;
    if (status?.succeeded && status.succeeded > 0) return;
    if (status?.failed && status.failed > 0) {
      throw new Error(`Image build job ${jobName} failed`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Image build job ${jobName} did not finish within ${timeoutMs}ms`);
}

function slugify(runId: string): string {
  return runId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
}

/**
 * Deploys the built image as its own tenant Namespace/Deployment/Service/
 * Ingress, and returns the app's public URL. Assumes buildImage() already
 * pushed `imageTag` to the in-cluster registry.
 */
async function deployApp(
  coreApi: k8s.CoreV1Api,
  appsApi: k8s.AppsV1Api,
  networkingApi: k8s.NetworkingV1Api,
  runId: string,
  imageTag: string,
  emit: ProgressEmitter
): Promise<string> {
  const namespace = `tenant-${slugify(runId)}`;
  const slug = slugify(runId);
  const host = `${slug}.${BASE_DOMAIN}`;

  emit("build", `Deploying to ${host}...`);

  await coreApi.createNamespace({ body: { metadata: { name: namespace } } }).catch((err) => {
    if (err?.body?.reason !== "AlreadyExists") throw err;
  });

  // PVC must exist before the Deployment that references it — otherwise the
  // pod schedules fine but sits stuck in ContainerCreating until the PVC
  // shows up moments later, an avoidable race.
  await coreApi.createNamespacedPersistentVolumeClaim({
    namespace,
    body: {
      metadata: { name: "app-data" },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "256Mi" } },
      },
    },
  });

  await appsApi.createNamespacedDeployment({
    namespace,
    body: {
      metadata: { name: "app", namespace },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: "app" } },
        template: {
          metadata: { labels: { app: "app" } },
          spec: {
            containers: [
              {
                name: "app",
                image: imageTag,
                ports: [{ containerPort: 3000 }],
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "256Mi" },
                },
                volumeMounts: [{ name: "data", mountPath: "/app/data" }],
              },
            ],
            volumes: [
              {
                name: "data",
                persistentVolumeClaim: { claimName: "app-data" },
              },
            ],
          },
        },
      },
    },
  });

  await coreApi.createNamespacedService({
    namespace,
    body: {
      metadata: { name: "app" },
      spec: {
        selector: { app: "app" },
        ports: [{ port: 80, targetPort: 3000 }],
      },
    },
  });

  await networkingApi.createNamespacedIngress({
    namespace,
    body: {
      metadata: { name: "app" },
      spec: {
        ingressClassName: "nginx",
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: { service: { name: "app", port: { number: 80 } } },
                },
              ],
            },
          },
        ],
        // No `tls:` block — TLS terminates at Cloudflare (Flexible SSL),
        // not in-cluster. The Ingress itself is plain HTTP.
      },
    },
  });

  // Public URL is still https:// — Cloudflare presents HTTPS to visitors
  // even though this Ingress and the hop to it are plain HTTP.
  return `https://${host}`;
}

/**
 * Builds the generated app into a container image and deploys it to its own
 * tenant namespace, returning its public URL. Replaces serve.ts entirely —
 * there is no single-tenant local dev server in the managed deployment.
 */
export async function buildAndDeploy(
  appDir: string,
  runId: string,
  emit: ProgressEmitter
): Promise<string> {
  const kc = kubeConfig();
  const batchApi = kc.makeApiClient(k8s.BatchV1Api);
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const appsApi = kc.makeApiClient(k8s.AppsV1Api);
  const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

  const contextDir = stageBuildContext(appDir, runId);
  const imageTag = await buildImage(batchApi, runId, contextDir, emit);
  const url = await deployApp(coreApi, appsApi, networkingApi, runId, imageTag, emit);

  emit("done", `Deployed. Your app is live at ${url}.`);
  return url;
}
