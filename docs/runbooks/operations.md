# Operator guide

- Owners issue the first staff logins at Team access. The password is shown once; the user must change it.
- Managers may issue, reset, or disable staff except owners.
- Opening inventory: count, submit, a **different** owner/manager approves. Approval posts stock and sets the factory live.
- Cutting: allocate a block to B-21, log operational days (07:00–07:00), complete with total cut and good count. Damaged pieces are not stocked.
- Polishing: grinding, optional resin, then polish. Cleared slabs are sellable.
- Sales: quote → reserve → pack → dispatch → invoice → payment. Payments cannot exceed the invoice. Retries use the same `clientOpId`.
- Tally imports are historical. They never move live stock.
- Offline: queued writes show in the sync bar. Inventory conflicts must be resolved; they are not overwritten.
