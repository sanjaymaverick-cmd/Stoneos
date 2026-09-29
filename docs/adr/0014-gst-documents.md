# ADR 0014 — GST documents on the same vouchers

## Status

Accepted 2026-09-12. **Amended 2026-09-29**: GST is charged on top of the quoted rate,
not carved out of it, and the heads follow place of supply. The original decision
below is superseded where the two disagree.

## Decision

Sale rates are quoted **exclusive** of GST. `Invoice.amount` is the customer total —
taxable value plus tax — and AR, payments and the overpay guard all settle against it.
`Invoice.taxableAmount` holds the pre-tax value (sum of quantity x rate).

Tax follows **place of supply**, not the customer's billing address:

| Supply | Heads | At 18% |
|---|---|---|
| Buyer in the factory's own state | CGST + SGST | 9% + 9% |
| Buyer in another state | IGST | 18% |

The supplying state is read from the **GSTIN itself** — its first two characters are the
state code — so a `stateCode` on the profile that contradicts the GSTIN is rejected
rather than silently routing tax to the wrong heads. The buyer's state comes from
`Customer.stateCode`, or from `Customer.gstin` when one is recorded. A buyer with
neither is supplied where the factory stands: a local counter sale.

A factory with no `GstProfile` charges nothing. It is not registered, and inventing a
rate would put a fictional liability in the books.

One ledger per head — `GST_OUTPUT_CGST`, `GST_OUTPUT_SGST`, `GST_OUTPUT_IGST` — because
GSTR-1 reports them separately and a single combined ledger cannot be split back apart
once posted. The former `GST_OUTPUT` is retired.

Tax is **frozen on the document at issue**: rate, both state codes and each head are
stored on `invoice` and `credit_note`. Nothing recomputes them from live profile or
customer rows, so editing a profile can never restate a filed return. A credit note
reverses the heads its invoice charged.

E-invoice and e-way persist IRN/EWB numbers. Without `STONEOS_GST_IRP_*` /
`STONEOS_GST_EWY_*`, services run mock and mark `source=mock`. GSTR-1 is JSON+CSV
export, carrying per-head columns and place of supply. Portal upload is not done from
push; live IRP calls require secrets and fail closed if GSTIN is missing. Secrets never
enter git — the factory's real GSTIN is data in `GstProfile`, never a source constant.

## Scope

18% is the only rate implemented (polished granite slabs, HSN 6802). Selling anything
at another rate — rough blocks under HSN 2516 are 5% — needs a per-item rate first.
