# Vedam Books + Khatabook cutover

Cutover date: **2026-09-12**. After this date, new sales and collections happen only in StoneOS. Khatabook is retired once the customer list is imported.

## Opening totals that must round-trip

| | Amount |
|---|---|
| Parties | 46 (including ₹0 Bhagwan ji Anooppura) |
| You'll Get (AR) | ₹1,25,61,248 |
| You'll Give (AP) | ₹1,63,671 |
| Net | ₹1,23,97,577 Dr |

You'll Give: Sri Balaji Granite Pandya ji 46,859; NR JOB 22,351; Charging Job 94,461.

You'll Get examples: Shakti 5,77,166; BHAWANA ENTERPRISES JAIPUR 8,53,001; Rajasthan Tiles Mh 29,616; Rajasthan Tiles Ringus 1,32,013; VIPUL GRANITE BLR 5,48,481; Balaji Granites Banglore Harlal ji 5,56,865.

Fixture used by tests: `apps/api/test/fixtures/khata/customer-list.json` (36 filler customers hold the remaining AR until the live PDFs are pasted). Re-import of the same totals is a no-op (`clientOpId` = sha256 of factoryId + khata-open + nameKey + 2026-09-12).

## Who may import

`HISTORICAL_IMPORT_ROLES` = owner, manager. Supervisor and bot **must not** import opening books. Trial balance stays `CEO_ROLES`. Statements include supervisor.

## Do not

- Mint `INV-YYYY-NNNNN` from Khatabook debit narration.
- Parse “Cash 97070” / “Vipul Cash 108162” out of Details and post a payment.
- Nightly Khatabook API sync.
- Write Tally XML into inventory.
- File GSTR from StoneOS (GST output is on the voucher; filing is outside).
- Muster/payroll unless the plant still needs it (not shipped).

## Intake

CSV templates: `templates/rokad.csv`, `templates/dpr.csv`. PDF/photo → `unreadable`. Proposer ≠ confirmer. Rokad out → expense. Rokad in with a matching open invoice → `sales.pay`; else unallocated. DPR missing block → no stock. `derivedDpr.slabsCut` comes from slab rows.

## GST

Invoice amount is the customer total. Voucher splits 18% GST inclusive onto `GST_OUTPUT`. File GSTR outside StoneOS.
