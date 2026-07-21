# The orchestrator's own Deployment — it needs to run inside the cluster,
# not on a laptop, because orchestrator/lib/pipeline/deploy.ts talks to the
# Kubernetes API directly and shares the build-root PVC with each build Job.
#
# Secrets management here is the minimum viable answer (plain kubernetes
# Secret, values supplied via TF_VAR_* env vars, never committed) — move to
# Sealed Secrets or Vault if/when that hardening is worth the extra
# operational cost. Not decided beyond "don't commit plaintext secrets."

variable "openai_api_key" {
  description = "Set via TF_VAR_openai_api_key, never commit it."
  type        = string
  sensitive   = true
}

resource "kubernetes_secret" "orchestrator_env" {
  metadata {
    name      = "orchestrator-env"
    namespace = "default"
  }
  data = {
    OPENAI_API_KEY = var.openai_api_key
    # Switches finish-run.ts from the local-dev serve.ts path to the real
    # deploy.ts (Kaniko build + k8s Deployment/Service/Ingress) path.
    ANASTASIS_DEPLOY_TARGET = "k8s"
    # Codex's own bubblewrap sandbox can't create its nested mount namespace
    # inside this pod's security context (confirmed against the real
    # deployment: "bwrap: Failed to make / slave: Permission denied").
    # KNOWN SECURITY TRADE-OFF: this means Codex's shell commands run with
    # this container's own permissions (including its scoped k8s
    # service-account token) instead of being sandboxed away from them.
    # Hardening follow-up: run the Codex build step in a separate pod with
    # no cluster RBAC at all, or properly enable nested unprivileged user
    # namespaces for this pod at the node level.
    ANASTASIS_CODEX_SANDBOX = "danger-full-access"
    # Whole pipeline on GPT-5.6: vision + reasoning stages via the API,
    # Codex pinned to the same family via CODEX_HOME config (entrypoint).
    ANASTASIS_VISION_MODEL    = "gpt-5.6-sol"
    ANASTASIS_REASONING_MODEL = "gpt-5.6-sol"
    # Postgres is provisioned (postgres.tf) but the orchestrator's own code
    # still uses local SQLite (orchestrator/lib/db/client.ts) — swapping the
    # driver is real surgery (every call site is synchronous better-sqlite3
    # today) that wasn't done in this pass. DATABASE_URL sits here unused
    # until that swap happens; SQLite persistence comes from the PVC below
    # instead.
    DATABASE_URL = "postgres://anastasis:${var.postgres_password}@anastasis-postgres.data.svc.cluster.local:5432/anastasis"
  }
}

resource "kubernetes_persistent_volume_claim" "orchestrator_data" {
  metadata {
    name      = "orchestrator-data"
    namespace = "default"
  }
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "1Gi" }
    }
  }
}

# runs/ holds each run's actual artifacts — uploaded video/zip, extracted
# frames, draft/final product-spec.json. Confirmed as a real gap, not
# theoretical: a run paused awaiting a clarification answer survived in the
# database (which was already on a PVC) but its product-spec.json did not,
# because runs/ was only ever in the pod's ephemeral filesystem — a pod
# restart during the pause (which happened, for unrelated reasons, while a
# real user's run was paused) silently made that run unresumable. Pods
# restart routinely in k8s (rollouts, node maintenance, crashes); pause/
# resume has to survive that to be a real feature, not a coincidence.
resource "kubernetes_persistent_volume_claim" "orchestrator_runs" {
  metadata {
    name      = "orchestrator-runs"
    namespace = "default"
  }
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "5Gi" }
    }
  }
}

# Same class of bug as orchestrator_runs above, caught one layer deeper:
# even with product-spec.json safely persisted, resuming a paused run still
# failed with "no rollout found for thread id ... (code -32600)" — Codex's
# own session/rollout history lives under CODEX_HOME
# (docker-entrypoint.sh sets this to /app/.codex-home), which was *also*
# only ever in the pod's ephemeral filesystem. Our own database remembering
# a session_id string is worthless if Codex's own process has no memory of
# that session after a restart.
resource "kubernetes_persistent_volume_claim" "orchestrator_codex_home" {
  metadata {
    name      = "orchestrator-codex-home"
    namespace = "default"
  }
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "5Gi" }
    }
  }
}

resource "kubernetes_service_account" "orchestrator" {
  metadata {
    name      = "orchestrator"
    namespace = "default"
  }
}

# Cluster-scoped because deploy.ts creates a brand new Namespace per tenant
# run — the set of namespaces it needs access to isn't known ahead of time.
# Scoped to exactly the resource types/verbs deploy.ts actually calls, not
# cluster-admin.
resource "kubernetes_cluster_role" "orchestrator" {
  metadata { name = "orchestrator" }
  rule {
    api_groups = [""]
    resources  = ["namespaces", "services", "persistentvolumeclaims"]
    verbs      = ["get", "list", "create", "delete"]
  }
  rule {
    api_groups = ["apps"]
    resources  = ["deployments"]
    verbs      = ["get", "list", "create", "delete"]
  }
  rule {
    api_groups = ["batch"]
    # jobs/status is a distinct subresource with its own RBAC entry —
    # confirmed by a real run that got all the way through Codex + smoke
    # and then 403'd polling its Kaniko build Job's completion
    # (readNamespacedJobStatus reads jobs/status, not jobs).
    resources  = ["jobs", "jobs/status"]
    verbs      = ["get", "list", "create", "delete"]
  }
  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["get", "list", "create", "delete"]
  }
}

resource "kubernetes_cluster_role_binding" "orchestrator" {
  metadata { name = "orchestrator" }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.orchestrator.metadata[0].name
  }
  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.orchestrator.metadata[0].name
    namespace = "default"
  }
}

resource "kubernetes_deployment" "orchestrator" {
  metadata {
    name      = "orchestrator"
    namespace = "default"
    labels    = { app = "orchestrator" }
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = "orchestrator" }
    }
    template {
      metadata {
        labels = { app = "orchestrator" }
      }
      spec {
        service_account_name = kubernetes_service_account.orchestrator.metadata[0].name
        # A second Hostinger VPS (72.61.5.12) joined the cluster as a plain
        # k3s agent specifically to host this — the orchestrator pod is
        # where Codex's own process (and its background test servers)
        # actually runs, and that's what OOM-killed the first VPS twice.
        # That box also runs its own production services (other client
        # sites, Postgres, Redis), same as VPS1, so this still isn't a
        # fully dedicated box — just a much quieter one.
        node_selector = { "anastasis-role" = "build" }
        container {
          name  = "orchestrator"
          image = "${var.orchestrator_image}"
          port {
            container_port = 3000
          }
          # Confirmed against a real deployment: with no limit at all, this
          # pod got OOM-killed mid-build — Codex's own background test
          # processes plus the independent migrate/smoke verification's own
          # dev server can stack up multiple concurrent Next.js instances.
          # 3Gi still wasn't enough (also OOM-killed, mid-Codex-build this
          # time) — bumped to 5Gi. Now running on VPS2 instead, which had
          # ~7.2Gi free vs VPS1's much more contested state at the time.
          resources {
            requests = { cpu = "250m", memory = "512Mi" }
            limits   = { cpu = "1800m", memory = "6Gi" }
          }
          env_from {
            secret_ref {
              name = kubernetes_secret.orchestrator_env.metadata[0].name
            }
          }
          volume_mount {
            name       = "build-root"
            mount_path = "/var/anastasis/builds"
          }
          volume_mount {
            name       = "data"
            mount_path = "/app/orchestrator/.data"
          }
          volume_mount {
            name       = "runs"
            mount_path = "/app/orchestrator/runs"
          }
          volume_mount {
            name       = "codex-home"
            mount_path = "/app/.codex-home"
          }
        }
        volume {
          name = "build-root"
          persistent_volume_claim {
            claim_name = "anastasis-build-root"
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.orchestrator_data.metadata[0].name
          }
        }
        volume {
          name = "runs"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.orchestrator_runs.metadata[0].name
          }
        }
        volume {
          name = "codex-home"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.orchestrator_codex_home.metadata[0].name
          }
        }
      }
    }
  }
}

variable "orchestrator_image" {
  description = "Image tag for the orchestrator itself, built and pushed the same way tenant apps are (see deploy.ts) but from this repo's orchestrator/ directory."
  type        = string
}

resource "kubernetes_service" "orchestrator" {
  metadata {
    name      = "orchestrator"
    namespace = "default"
  }
  spec {
    selector = { app = "orchestrator" }
    port {
      port        = 80
      target_port = 3000
    }
  }
}

resource "kubernetes_ingress_v1" "orchestrator" {
  metadata {
    name      = "orchestrator"
    namespace = "default"
    annotations = {
      # Screen recording uploads run tens of MB — caught by an actual live
      # upload test returning 413 before this was added (see also
      # infra/nginx/anastasis.conf's client_max_body_size, the other layer
      # this request passes through).
      "nginx.ingress.kubernetes.io/proxy-body-size" = "200m"
    }
  }
  spec {
    ingress_class_name = "nginx"
    rule {
      host = var.orchestrator_host
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service.orchestrator.metadata[0].name
              port { number = 80 }
            }
          }
        }
      }
    }
  }
}

variable "orchestrator_host" {
  description = "Hostname for the orchestrator's own UI"
  type        = string
  default     = "anastasis.app"
}
