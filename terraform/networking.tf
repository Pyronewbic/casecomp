resource "google_compute_global_address" "api_ip" {
  name = "cardscrapebot-ip"

  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "api_neg" {
  for_each              = toset(var.regions)
  name                  = each.value == "asia-south1" ? "casecomp-api-neg" : "casecomp-api-neg-${each.value}"
  region                = each.value
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.api[each.value].name
  }
}

resource "google_compute_backend_service" "api_backend" {
  name = "cardscrapebot-backend"

  dynamic "backend" {
    for_each = toset(var.regions)
    content {
      group = google_compute_region_network_endpoint_group.api_neg[backend.value].id
    }
  }
}

resource "google_compute_region_network_endpoint_group" "site_neg" {
  for_each              = toset(var.regions)
  name                  = each.value == "asia-south1" ? "casecomp-site-neg" : "casecomp-site-neg-${each.value}"
  region                = each.value
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.site[each.value].name
  }
}

resource "google_compute_backend_service" "site_backend" {
  name       = "casecomp-site-backend"
  enable_cdn = true

  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    max_ttl                      = 86400
    signed_url_cache_max_age_sec = 0
  }

  dynamic "backend" {
    for_each = toset(var.regions)
    content {
      group = google_compute_region_network_endpoint_group.site_neg[backend.value].id
    }
  }
}

resource "google_compute_url_map" "api_urlmap" {
  name            = "cardscrapebot-urlmap"
  default_service = google_compute_backend_service.site_backend.id

  host_rule {
    hosts        = [var.api_domain]
    path_matcher = "api"
  }

  host_rule {
    hosts        = [var.site_domain, "www.${var.site_domain}"]
    path_matcher = "site"
  }

  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api_backend.id
  }

  path_matcher {
    name            = "site"
    default_service = google_compute_backend_service.site_backend.id
  }
}

resource "google_compute_managed_ssl_certificate" "api_cert" {
  name = "cardscrapebot-cert-v2"

  managed {
    domains = [var.api_domain]
  }
}

resource "google_compute_managed_ssl_certificate" "site_cert" {
  name = "casecomp-site-cert"

  managed {
    domains = [var.site_domain, "www.${var.site_domain}"]
  }
}

resource "google_compute_target_https_proxy" "api_proxy" {
  name    = "cardscrapebot-https-proxy"
  url_map = google_compute_url_map.api_urlmap.id
  ssl_certificates = [
    google_compute_managed_ssl_certificate.api_cert.id,
    google_compute_managed_ssl_certificate.site_cert.id,
  ]
}

resource "google_compute_global_forwarding_rule" "api_https" {
  name       = "cardscrapebot-https-rule"
  target     = google_compute_target_https_proxy.api_proxy.id
  ip_address = google_compute_global_address.api_ip.id
  port_range = "443"
}
