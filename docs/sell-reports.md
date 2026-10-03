# Sell reports and invoice dates

Sell and Sell by lot link to /sales/reports. Money links there for accounting users.

Reports support all history, month, calendar year, and custom ranges with no one-year cap. Filters select customer/supplier, one party, and statements, sales, purchases, payments, or dues. Dues include opening balances and all entries through the end date; the start date limits period activity, not the closing balance. Advances are separate from dues. Excel contains customer and supplier summaries, transactions, payments, and notes. Print / Save PDF uses the browser print dialog and a landscape print stylesheet.

Invoices have a calendar invoice date distinct from created_at. Both issue paths validate real dates and reject future dates. The invoice date drives fiscal-year numbering, sales ledger posting, daily reports, and GSTR-1. Existing invoices are backfilled from their original creation date in IST; creation timestamps are preserved. The new columns are additive, so older code can still run.

Reports read invoices/payments/credit notes, raw-block receipts and cash sales, supplemented by opening and manual AR/AP vouchers. Source vouchers already represented by documents are excluded to prevent double counting. All reads are scoped to the authenticated factory in one repeatable-read snapshot. Report endpoints require commercial read roles; operators cannot export books. XLSX text cells do not evaluate spreadsheet formulas.

New purchase receipts capture payments against the bill and their mode. Historical receipt payments with no captured mode are labelled Not recorded. Cash purchase legs retain their recorded cash mode. Customer collections capture amount, date, and mode. This work does not import Khatabook data or alter historical financial amounts.
