# Dated opening balances

Books > Opening balances accepts arbitrary verified quantities and values without historical invoices: raw blocks, unfinished lots, finished lots, consumables, debtors, creditors, cash and bank. Retain source references and notes. Stock references must be unique. Consumable units currently support piece and litre; amounts are limited to Rs 2 crore per line by existing integer-paise vouchers.

Use the snapshot date, not the entry date. For 1 October stock entered on 9 October, open its actual 1 October state and record subsequent purchases, cutting, processing, receipts and dispatches separately. A block cut during the interval opens as a raw block; do not also open its resulting finished output. Slabs already cut at the snapshot open as rough on ground, grinding, resin, polishing, or finished according to their actual state. Machine/work location is descriptive. Unfinished lots have zero polished slabs until completion is recorded. Opening stages are retained in the line and inventory note; they do not create running machine sessions.

A 9 October count cannot be backdated to 1 October without reconstructing intervening movements. StoneOS cannot infer missing production history. Reconcile interval records already present: openings add missing stock and balances rather than replace existing records.

Owner/manager creates and edits a draft, then submits it. A different owner/manager who did not enter/edit it approves, acknowledging that records are missing and reconciled. One general opening batch is allowed per factory. Approval is atomic; failures roll back all stock and postings. Approved openings are immutable; no reversal workflow is included. Existing LIVE factories retain go-live dates; SETUP factories become LIVE at the opening date.

Opening asset/liability values post against opening equity, without invented sales, purchase invoices or GST. Opening debtor/creditor dues support dated partial settlements directly. Overpayments and payments before the opening date are rejected. Actual payment mode, arbitrary recipient, reference and note are retained in receipts and voucher memos. Pending cash/bank portions explain the same debt. Clarify them later through Sales customer Edit. UPI can settle a cash-pending portion; choosing that allocation reduces it atomically. Recipient names do not create separate bank ledgers.

Party statements, outstanding balances, collection totals and analytics include dated opening dues and settlements. Collection plans are current snapshots, not historical balances. Posted payments are immutable.

Migrations 20261009120000_collection_details and 20261009140000_general_opening_balances are additive. Roll back application code while retaining added fields/tables and entered data. Do not reverse migrations or delete settlements. Back up before deployment.
