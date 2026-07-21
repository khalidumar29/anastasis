# Self-hosted, ClusterIP-only image registry — no cloud registry account
# exists, and this one is never exposed publicly. containerd on the node
# must be configured to trust it as insecure/plain-http (see
# infra/runbook-phase1.md step 2) since it's cluster-internal traffic only.

resource "kubernetes_persistent_volume_claim" "registry_data" {
  metadata {
    name      = "registry-data"
    namespace = "kube-system"
  }
  # local-path's StorageClass uses WaitForFirstConsumer binding — it won't
  # bind until the registry Deployment's pod is actually scheduled, so
  # Terraform must not block waiting for "Bound" here.
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "20Gi" }
    }
  }
}

resource "kubernetes_deployment" "registry" {
  metadata {
    name      = "registry"
    namespace = "kube-system"
    labels    = { app = "registry" }
  }
  spec {
    replicas = 1
    selector {
      match_labels = { app = "registry" }
    }
    template {
      metadata {
        labels = { app = "registry" }
      }
      spec {
        container {
          name  = "registry"
          image = "registry:2"
          port {
            container_port = 5000
          }
          volume_mount {
            name       = "data"
            mount_path = "/var/lib/registry"
          }
        }
        volume {
          name = "data"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.registry_data.metadata[0].name
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "registry" {
  metadata {
    name      = "registry"
    namespace = "kube-system"
  }
  spec {
    # Pinned: containerd on the host can't resolve *.svc.cluster.local DNS
    # names when pulling images (only pods get CoreDNS via resolv.conf) —
    # /etc/rancher/k3s/registries.yaml mirrors that hostname to this literal
    # ClusterIP instead. Keep them in sync if this ever changes.
    cluster_ip = "10.43.42.106"
    selector   = { app = "registry" }
    port {
      port        = 5000
      target_port = 5000
    }
    type = "ClusterIP"
  }
}

# Shared PVC for staging build contexts between the orchestrator Deployment
# and each per-run Kaniko Job (see orchestrator/lib/pipeline/deploy.ts).
# ReadWriteOnce is fine on a single node; moving to multiple nodes needs a
# ReadWriteMany-capable StorageClass (e.g. NFS or Longhorn) instead.
resource "kubernetes_persistent_volume_claim" "build_root" {
  metadata {
    name      = "anastasis-build-root"
    namespace = "default"
  }
  # No consumer exists yet — that's expected. Each per-run Kaniko Job
  # mounts this later (see deploy.ts); it binds on first real use.
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "10Gi" }
    }
  }
}
