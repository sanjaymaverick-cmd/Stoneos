#!/usr/bin/env bash
# Import the live Khatabook customer-list PDF on the smoke stack.
# Usage: STONEOS_OWNER_USER=owner STONEOS_OWNER_PASSWORD=... bash scripts/khata-cutover-smoke.sh
set -euo pipefail
API=${STONEOS_API_URL:-http://localhost:4000}
USER=${STONEOS_OWNER_USER:-owner}
PASS=${STONEOS_OWNER_PASSWORD:?set STONEOS_OWNER_PASSWORD in the environment}
PDF=${KHATA_PDF:-apps/api/test/fixtures/khata/pdf/customer-list.pdf}

TOKEN=$(curl -sS -X POST "$API/api/v1/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

B64=$(python3 - "$PDF" <<'PY'
import base64,sys
print(base64.b64encode(open(sys.argv[1],'rb').read()).decode())
PY
)

curl -sS -X POST "$API/api/v1/books/khata/import" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"fileName\":\"customer-list.pdf\",\"base64\":\"$B64\",\"contentType\":\"application/pdf\",\"confirm\":true}" >/tmp/khata-import.json

curl -sS "$API/api/v1/books/outstanding" -H "authorization: Bearer $TOKEN" | python3 - <<'PY'
import json,sys
out=json.load(sys.stdin)
assert out["youllGet"]==12561248, out
assert out["youllGive"]==163671, out
print("outstanding_ok", out["youllGet"], out["youllGive"])
PY
