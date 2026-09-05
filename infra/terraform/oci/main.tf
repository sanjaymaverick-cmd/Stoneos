data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.42.0.0/16"]
  display_name   = "${var.name}-vcn"
  dns_label      = "stoneos"
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-igw"
}

resource "oci_core_nat_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-nat"
}

resource "oci_core_service_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-sgw"
  services {
    service_id = data.oci_core_services.all.services[0].id
  }
}

data "oci_core_services" "all" {}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public-rt"
  route_rules {
    network_entity_id = oci_core_internet_gateway.this.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-private-rt"
  route_rules {
    network_entity_id = oci_core_nat_gateway.this.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_security_list" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-public-sl"
  ingress_security_rules {
    protocol    = "6"
    source      = var.allowed_cidr
    source_type = "CIDR_BLOCK"
    tcp_options {
      min = 443
      max = 443
    }
  }
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_security_list" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name}-private-sl"
  ingress_security_rules {
    protocol    = "6"
    source      = "10.42.0.0/16"
    source_type = "CIDR_BLOCK"
    tcp_options {
      min = 4000
      max = 4000
    }
  }
  ingress_security_rules {
    protocol    = "6"
    source      = "10.42.0.0/16"
    source_type = "CIDR_BLOCK"
    tcp_options {
      min = 5432
      max = 5432
    }
  }
  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.this.id
  cidr_block        = "10.42.1.0/24"
  display_name      = "${var.name}-public"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
}

resource "oci_core_subnet" "private" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = "10.42.2.0/24"
  display_name               = "${var.name}-private"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.private.id]
}

resource "oci_core_subnet" "db" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.this.id
  cidr_block                 = "10.42.3.0/24"
  display_name               = "${var.name}-db"
  prohibit_public_ip_on_vnic = true
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_security_list.private.id]
}

resource "oci_vault_secret" "session" {
  compartment_id = var.compartment_ocid
  secret_name    = "${var.name}-session"
  vault_id       = oci_kms_vault.this.id
  key_id         = oci_kms_key.this.id
  secret_content {
    content_type = "BASE64"
    content      = base64encode("replace-after-apply-with-generated-secret")
  }
  lifecycle {
    ignore_changes = [secret_content]
  }
}

resource "oci_kms_vault" "this" {
  compartment_id = var.compartment_ocid
  display_name   = "${var.name}-vault"
  vault_type     = "DEFAULT"
}

resource "oci_kms_key" "this" {
  compartment_id      = var.compartment_ocid
  display_name        = "${var.name}-key"
  management_endpoint = oci_kms_vault.this.management_endpoint
  key_shape {
    algorithm = "AES"
    length    = 32
  }
}

resource "oci_objectstorage_bucket" "files" {
  compartment_id = var.compartment_ocid
  name           = "${var.name}-files"
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  access_type    = "NoPublicAccess"
}

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.tenancy_ocid
}

output "vcn_id" { value = oci_core_vcn.this.id }
output "private_subnet_id" { value = oci_core_subnet.private.id }
output "db_subnet_id" { value = oci_core_subnet.db.id }
output "vault_id" { value = oci_kms_vault.this.id }
output "bucket" { value = oci_objectstorage_bucket.files.name }
