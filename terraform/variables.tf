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
  default = "gcr.io/casecomp-495718/casecomp-api"
}

variable "alert_email" {
  sensitive = true
}

