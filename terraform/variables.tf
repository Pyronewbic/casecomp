variable "project_id" {
  default = "casecomp-495718"
}

variable "region" {
  default = "asia-south1"
}

variable "api_domain" {
  default = "api.casecomp.xyz"
}

variable "site_domain" {
  default = "casecomp.xyz"
}

variable "container_image" {
  default = "us-docker.pkg.dev/casecomp-495718/casecomp-api/app"
}

variable "regions" {
  type    = list(string)
  default = ["asia-south1", "us-central1"]
}

variable "alert_email" {
  sensitive = true
}

