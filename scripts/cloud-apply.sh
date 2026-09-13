#!/usr/bin/env bash
# Optional cloud apply. Never run from push-to-main.
# Usage: PROVIDER=aws|oci AUTO_APPROVE=false bash scripts/cloud-apply.sh
set -euo pipefail
PROVIDER=${PROVIDER:-}
AUTO_APPROVE=${AUTO_APPROVE:-false}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR="$ROOT/infra/terraform/$PROVIDER"

if [[ "$PROVIDER" != "aws" && "$PROVIDER" != "oci" ]]; then
  echo "PROVIDER must be aws or oci" >&2
  exit 2
fi
if [[ ! -d "$DIR" ]]; then
  echo "missing $DIR" >&2
  exit 2
fi

if [[ "$PROVIDER" == "aws" ]]; then
  : "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
  : "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
fi
if [[ "$PROVIDER" == "oci" ]]; then
  : "${OCI_TENANCY_OCID:?OCI_TENANCY_OCID is required}"
  : "${OCI_USER_OCID:?OCI_USER_OCID is required}"
  : "${OCI_FINGERPRINT:?OCI_FINGERPRINT is required}"
  : "${OCI_REGION:?OCI_REGION is required}"
fi

terraform -chdir="$DIR" init
terraform -chdir="$DIR" validate
if [[ "$AUTO_APPROVE" == "true" ]]; then
  terraform -chdir="$DIR" apply -auto-approve
else
  terraform -chdir="$DIR" apply
fi
echo "Set DATABASE_URL from terraform output postgres_endpoint"
echo "Set STORAGE_DRIVER=s3 or oci and S3_BUCKET from terraform output files_bucket"
echo "Local default remains STORAGE_DRIVER=local"
