variable "region" {
  type        = string
  description = "OCI region, e.g. ap-mumbai-1"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment for StoneOS"
}

variable "tenancy_ocid" {
  type = string
}

variable "name" {
  type    = string
  default = "stoneos"
}

variable "ssh_public_key" {
  type = string
}

variable "allowed_cidr" {
  type        = string
  description = "VPN or office CIDR allowed to reach the reverse proxy"
  default     = "10.0.0.0/8"
}
