# Revised from the original plan after actually bootstrapping the real VPS:
# it already runs several other live sites behind nginx with real Certbot
# certs (careerpointsaifurs.com, api.shifuit.com, ovidio.app,
# nutshellbytes.com, bolscan.app). k3s's default Traefik+ServiceLB grabs
# ports 80/443, which would have collided with that nginx — so k3s was
# installed with --disable=traefik --disable=servicelb, and this installs
# ingress-nginx instead, exposed on fixed NodePorts that never touch 80/443.
# The existing host nginx is then the single front door for everything
# (unchanged for its existing sites), with one new server block (see
# infra/nginx/anastasis.conf) proxying anastasis.app + *.anastasis.app to
# this NodePort. TLS terminates at Cloudflare (Flexible SSL mode — the
# origin hop is plain HTTP), so there is no cert-manager/ClusterIssuer here;
# see dns.tf for the one DNS record this setup still needs.

resource "helm_release" "ingress_nginx" {
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  namespace        = "ingress-nginx"
  create_namespace = true

  set {
    name  = "controller.service.type"
    value = "NodePort"
  }
  set {
    name  = "controller.service.nodePorts.http"
    value = "30080"
  }
  set {
    name  = "controller.service.nodePorts.https"
    value = "30443"
  }
}
