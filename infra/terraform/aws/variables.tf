variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  type    = string
  default = "stoneos"
}

variable "allowed_cidr" {
  type        = string
  description = "VPN or office CIDR allowed to the load balancer"
  default     = "10.0.0.0/8"
}
