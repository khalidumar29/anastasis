# Domain is live: anastasis.app, DNS already on Cloudflare, root record
# already proxied. TLS mode chosen: Cloudflare Flexible SSL — Cloudflare
# terminates public HTTPS with its own certificate; the hop from Cloudflare
# to this origin is plain HTTP (see infra/nginx/anastasis.conf). That means
# no cert-manager, no ClusterIssuer, no Cloudflare Origin Certificate here —
# the only thing this file needs to manage is the wildcard DNS record
# itself, and only once a Cloudflare API token exists (not committed).
#
# Until that token is supplied, add the record manually in the Cloudflare
# dashboard: Type A, Name "*", Content 147.93.107.185, Proxy status: Proxied.

variable "cloudflare_api_token" {
  description = "Cloudflare API token scoped to Zone:DNS:Edit for anastasis.app. Set via TF_VAR_cloudflare_api_token, never commit it."
  type        = string
  sensitive   = true
  default     = ""
}

variable "base_domain" {
  description = "The domain apps are served under"
  type        = string
  default     = "anastasis.app"
}

variable "vps_ip" {
  description = "The Hostinger VPS's public IP address"
  type        = string
  default     = "147.93.107.185"
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "cloudflare_zone" "base" {
  count = var.cloudflare_api_token != "" ? 1 : 0
  name  = var.base_domain
}

resource "cloudflare_record" "wildcard" {
  count   = var.cloudflare_api_token != "" ? 1 : 0
  zone_id = data.cloudflare_zone.base[0].id
  name    = "*"
  type    = "A"
  content = var.vps_ip
  proxied = true # matches the root record — Cloudflare Flexible SSL terminates HTTPS at its edge
}
