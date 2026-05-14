output "cloud_run_urls" {
  value = { for r in var.regions : r => google_cloud_run_v2_service.api[r].uri }
}

output "lb_ip" {
  value = google_compute_global_address.api_ip.address
}

output "api_url" {
  value = "https://${var.api_domain}"
}
