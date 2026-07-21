# Phase 1 — what's actually running on the VPS

Updated after actually bootstrapping the real VPS (147.93.107.185,
anastasis.app). This diverged from the original plan in one important way:
**the box already runs other live sites** (careerpointsaifurs.com,
api.shifuit.com, ovidio.app/audiofy, automation.nutshellbytes.com/n8n,
api.bolscan.app) behind nginx with real Certbot certs, native Postgres 17,
Redis, and PM2. Nothing here touches any of that.

## What's live right now

1. **k3s**, installed with `--disable=traefik --disable=servicelb` so it
   never competes for ports 80/443 with the existing nginx.
   ```
   curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='--disable=traefik --disable=servicelb --write-kubeconfig-mode=644' sh -
   ```
2. **containerd** configured to trust the in-cluster registry as
   insecure/plain-http (`/etc/rancher/k3s/registries.yaml`), then
   `systemctl restart k3s` to pick it up. **Gotcha that cost real debugging
   time**: the mirror's `endpoint` must be the registry Service's literal
   ClusterIP (e.g. `http://10.43.42.106:5000`), not its
   `*.svc.cluster.local` DNS name. Pods resolve that name fine via CoreDNS,
   but image *pulls* are done by containerd on the host's own network
   namespace, which has no CoreDNS in its resolv.conf — pointing the mirror
   at the same unresolvable DNS name just moves the failure, it doesn't fix
   it. `infra/terraform/registry.tf` pins the registry Service's
   `cluster_ip` explicitly so this stays stable across recreates.
3. **ingress-nginx**, exposed on fixed NodePorts 30080 (http) / 30443
   (https) — never touches 80/443 either. Managed by
   `infra/terraform/cluster.tf`.
4. **The existing host nginx** gets one new server block,
   `infra/nginx/anastasis.conf` (deployed to
   `/etc/nginx/sites-available/anastasis.conf`, symlinked into
   `sites-enabled/`), routing `anastasis.app` + `*.anastasis.app` to the
   ingress-nginx NodePort. Every other site's config is untouched.
5. **TLS**: Cloudflare Flexible SSL — Cloudflare terminates public HTTPS
   with its own certificate; the hop from Cloudflare to this origin is
   plain HTTP. No cert-manager, no Certbot, no per-app certs needed. This
   means: **verify in the Cloudflare dashboard that SSL/TLS mode is set to
   "Flexible"** for anastasis.app (Terraform/API access wasn't available to
   confirm this automatically).
6. **In-cluster registry** (`registry:2`, ClusterIP-only,
   `infra/terraform/registry.tf`) — verified reachable from inside the
   cluster.
7. **Postgres** (`postgres:16` official image, not the Bitnami Helm chart —
   that chart was pinned to an image tag Bitnami has since pulled from
   Docker Hub's free tier; a plain Deployment avoids that churn) —
   verified up and accepting connections. Password generated locally,
   stored only as a k8s Secret (`postgres-auth` in namespace `data`) — get
   it via `kubectl get secret postgres-auth -n data -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d`
   if you need it, don't ask me to repeat it in chat.
8. **Shared build-root PVC** (`anastasis-build-root` in `default`) for
   staging Kaniko build contexts — used for real to build the orchestrator's
   own image (see below), and shared with per-tenant Kaniko Jobs via
   `deploy.ts`.
9. **The orchestrator itself**, containerized (`orchestrator/Dockerfile`,
   build context is the *repo root* since `build.ts` expects `template/` and
   `Agents.md` as siblings one level up from `orchestrator/`) and deployed
   in-cluster (`infra/terraform/orchestrator.tf`): its own Deployment,
   Service, Ingress (host `anastasis.app`), a ServiceAccount + ClusterRole
   scoped to exactly what `deploy.ts` calls (namespaces, deployments,
   services, PVCs, jobs, ingresses — not cluster-admin), a PVC for its
   SQLite state, and a Secret with its own `OPENAI_API_KEY`. The image was
   built via a real Kaniko Job (the same mechanism `deploy.ts` uses for
   tenant apps) — this doubled as the first real end-to-end test of that
   build path. Codex CLI re-authenticates on every container start via
   `codex login --with-api-key` (`orchestrator/docker-entrypoint.sh`) using
   this deployment's own key — not a copied personal credential.
   **Note**: still running on local SQLite (mounted from a PVC for
   persistence across restarts), not the in-cluster Postgres — swapping
   `orchestrator/lib/db/client.ts` from `better-sqlite3` to `pg` is a real
   driver change (synchronous → async, every call site) that wasn't done in
   this pass. Postgres sits provisioned but unused until that swap happens.

End-to-end verified, for real, through the whole path (Cloudflare → host
nginx → ingress-nginx NodePort → orchestrator Service → pod):
`curl http://anastasis.app` returns the actual Anastasis UI with HTTP 200.

## Still pending

- **Cloudflare SSL/TLS mode**: `https://anastasis.app` currently returns
  **502** — Cloudflare is attempting to reach the origin over HTTPS, but
  this origin only serves plain HTTP (by design — see TLS note above).
  Needs a one-time manual switch to **Flexible** in the dashboard (SSL/TLS →
  Overview). `http://anastasis.app` already works (200) right now, proving
  everything behind it is correct — this is purely the SSL mode setting.
- **DNS**: the root `anastasis.app` A record already existed (proxied
  through Cloudflare) — that's enough for the orchestrator's own UI, already
  verified working. Still needed for *tenant* apps: a wildcard record —
  **Type A, Name `*`, Content `147.93.107.185`, Proxy status: Proxied** — so
  `<slug>.anastasis.app` resolves anywhere. I don't have Cloudflare API
  access (checked: the "Cloudflare MCP" mentioned lives in the local Codex
  desktop app's own config, not reachable from this session or from
  `codex exec` in non-interactive mode) — add it manually, or give me a
  token scoped to `Zone:DNS:Edit` for anastasis.app.
- **`infra/terraform/dns.tf`**: not applied (needs the same Cloudflare
  token above) — currently just declares the wildcard record for when a
  token exists.
- **`orchestrator/lib/pipeline/deploy.ts`**: code-complete and its
  underlying mechanism (Kaniko build + push to the in-cluster registry) is
  now proven end-to-end via the orchestrator's own image build — but
  `deploy.ts` itself (the per-tenant-run path: Namespace/Deployment/Service/
  Ingress creation via `@kubernetes/client-node`) hasn't been exercised by
  an actual pipeline run yet.
- **Swapping SQLite for Postgres** in the orchestrator's own persistence
  layer — Postgres is up and healthy but unused (see note above).

## SSH access

A dedicated ed25519 key was added to `root`'s `authorized_keys` for this
session's work. The original root password was shared in plaintext in
chat — **rotate it** (`passwd`) once you've reviewed everything here.
