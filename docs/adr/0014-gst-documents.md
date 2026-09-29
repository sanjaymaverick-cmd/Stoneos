# ADR 0014 — GST documents on the same vouchers

## Status

Accepted 2026-09-12. **Amended 2026-09-29**: GST is charged on top of the quoted rate,
not carved out of it, and the heads follow place of supply. Further amended the same day
for retail (B2C) buyers, ancillary charges, and unbilled cash sales, then again for
selectable rate slabs and input tax credit. The original decision is superseded where
they disagree.

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

## Retail buyers and GSTR-1 tables

A buyer without a GSTIN is still taxed: 9% + 9% in the factory's own state, 18% IGST
outside it. What changes is the table they are filed in, not the tax.

| Buyer | Table |
|---|---|
| Has a GSTIN | B2B, invoice-wise |
| No GSTIN, inter-state, invoice above ₹2,50,000 | B2CL, invoice-wise |
| Every other buyer without a GSTIN | B2CS, consolidated |

Filing a retail buyer as B2B is a defect, so the split is driven off the presence of
`Customer.gstin` and nothing else.

## Charges on an invoice

Packaging, demurrage, loading labour, customised packing and similar charges are billed
as `invoice_charge` rows. Section 15 makes ancillary charges part of the transaction
value, so a charge is **taxed with the principal supply by default**. `taxable: false`
exists for a genuine pure-agent reimbursement: it is added to the payable and to the
sales ledger, and carried on `invoice.exemptAmount`, but never taxed.

## Cash sales with no invoice

An order may be marked `billingMode: cash_unbilled`. It raises no invoice, no IRN and no
GST document, so it cannot and does not appear in GSTR-1. The stock movement, the cash
and an audit event are still recorded, and the revenue posts to a dedicated
`SALES_UNBILLED` ledger so invoiced turnover always reconciles against the returns
without anyone subtracting by hand. `invoice()` refuses such an order and
`recordCashSale()` refuses any other, so the two paths cannot be crossed by accident.

Two deliberate pieces of friction:

- Every GSTR-1 response carries `excludedCashSales` — the count and value left out of
  that return — so filed turnover is never mistaken for total turnover.
- The CEO brief raises `UNBILLED_CASH_SALES` with the month's unbilled value and its
  share of turnover, escalating to `warn` at 25%.

This records a decision; it does not discharge a liability. Under GST a taxable supply
attracts tax whether or not an invoice was raised, so unbilled sales remain the owner's
exposure and a matter for their accountant. StoneOS keeps the number visible rather
than losing it.

## Rates are chosen, not assumed

A rate is picked per document from the statutory slabs — **0, 0.25, 3, 5, 12, 18, 28** —
and anything else is rejected at entry. A typed 15% or 8% would otherwise pass through
every downstream sum and only surface at filing.

| Document | Default | Why |
|---|---:|---|
| Sales invoice | 18% | Polished slabs, HSN 6802 |
| Raw block purchase | 5% | Rough or unworked blocks, HSN 2516 |
| Expense / consumable | 18% | Commonest, but consumables sit on several slabs |

Every default is overridable per document (`gstRatePct`). The rate is frozen on the
document once booked. `GET /api/v1/gst/rates` serves the slabs and the defaults so the
UI offers a choice rather than hardcoding one.

The rate is per **document**, not per line. A bill mixing slabs is entered as two
documents; that is simpler than per-line rates and matches how a yard actually buys.

## Input tax credit

Purchases previously posted nothing at all — no payable, no stock value, no recoverable
tax. Receiving a block now posts a `purchase` voucher:

```
STOCK              Dr  taxable value
GST_INPUT_CGST/…   Dr  tax paid
  AP                   Cr  taxable + tax   (the vendor is owed the whole bill)
```

**Stock and expense ledgers carry the value before tax.** GST paid is recoverable
credit, an asset, not a cost of the stone or of running the plant — charging the whole
bill to stock would overstate block cost, and with it the damaged-slab write-off that
derives from it.

Credit is only claimed where it exists: a spend with no `gstRatePct` (an unregistered
hand, a cash chit) posts its whole value to expense and claims nothing. A factory with
no `GstProfile` claims nothing either.

`GET /api/v1/gst/position?month=YYYY-MM` reads the ledgers — not the documents, which
may since have been edited — and reports output less input per head, the net payable,
and any credit carried forward. Netting is **head-wise only**; cross-utilisation
between CGST, SGST and IGST follows its own statutory order and is a filing decision,
not one to assume here.

At 5% in and 18% out this factory is not in an inverted duty structure: output exceeds
input on normal trade, so GST is settled in cash and no refund claim arises.

## Scope

`B2CL_INVOICE_THRESHOLD` is a single constant; it has moved before and should not be
assumed permanent. Cross-head utilisation, GSTR-3B generation, GSTR-2B reconciliation
against supplier filings, and reverse charge are all out of scope. Nothing checks that a
claimed credit actually appears in the supplier's return, so the credit figure is what
this factory recorded, not what the portal will allow.
