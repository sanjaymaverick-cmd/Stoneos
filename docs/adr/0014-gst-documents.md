# ADR 0014 — GST documents on the same vouchers

## Status

Accepted. 2026-09-12.

## Decision

Invoice amount stays the customer total. Vouchers already split 18% inclusive onto `GST_OUTPUT`. E-invoice and e-way persist IRN/EWB numbers. Without `STONEOS_GST_IRP_*` / `STONEOS_GST_EWY_*`, services run mock and mark `source=mock`. GSTR-1 is JSON+CSV export. Portal upload is not done from push; live IRP calls require secrets and fail closed if GSTIN is missing. Secrets never enter git.
