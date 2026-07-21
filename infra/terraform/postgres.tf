# Single-instance Postgres for the orchestrator's persistence layer (runs,
# pending_questions, deployments, custom_domains — see
# orchestrator/lib/db/schema.sql, which the orchestrator applies itself on
# startup, same as it does against local SQLite in dev). ClusterIP-only,
# backed by local-path storage — no managed database service.
#
# Plain Deployment with the official postgres image, not the Bitnami Helm
# chart — the chart turned out to be pinned to an image tag
# (bitnami/postgresql:17.1.0-debian-12-r0) that Bitnami has since removed
# from Docker Hub's free tier, a known problem with pinned Bitnami chart
# versions. The official image doesn't have that churn.

variable "postgres_password" {
  description = "Password for the anastasis Postgres user. Set via TF_VAR_postgres_password, never commit it."
  type        = string
  sensitive   = true
}

resource "kubernetes_namespace" "data" {
  metadata {
    name = "data"
  }
}

resource "kubernetes_secret" "postgres_auth" {
  metadata {
    name      = "postgres-auth"
    namespace = kubernetes_namespace.data.metadata[0].name
  }
  data = {
    POSTGRES_USER     = "anastasis"
    POSTGRES_PASSWORD = var.postgres_password
    POSTGRES_DB       = "anastasis"
  }
}

resource "kubernetes_persistent_volume_claim" "postgres_data" {
  metadata {
    name      = "postgres-data"
    namespace = kubernetes_namespace.data.metadata[0].name
  }
  # local-path's StorageClass uses WaitForFirstConsumer binding — see
  # registry.tf's registry_data PVC for the same note.
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "5Gi" }
    }
  }
}

resource "kubernetes_deployment" "postgres" {
  metadata {
    name      = "postgres"
    namespace = kubernetes_namespace.data.metadata[0].name
    labels    = { app = "postgres" }
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = "postgres" }
    }
    template {
      metadata {
        labels = { app = "postgres" }
      }
      spec {
        container {
          name  = "postgres"
          image = "postgres:16"
          port {
            container_port = 5432
          }
          env_from {
            secret_ref {
              name = kubernetes_secret.postgres_auth.metadata[0].name
            }
          }
          volume_mount {
            name       = "data"
            mount_path = "/var/lib/postgresql/data"
            sub_path   = "pgdata" # avoid postgres complaining about lost+found in a fresh volume root
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.postgres_data.metadata[0].name
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "postgres" {
  metadata {
    name      = "anastasis-postgres"
    namespace = kubernetes_namespace.data.metadata[0].name
  }
  spec {
    selector = { app = "postgres" }
    port {
      port        = 5432
      target_port = 5432
    }
  }
}
