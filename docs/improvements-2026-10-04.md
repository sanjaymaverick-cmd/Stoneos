# StoneOS improvements — implementation order

User authorised all listed improvements except offsite backups. OpenAI is the selected AI provider. Statutory integrations remain test-only until approved credentials and an actual provider adapter are configured.

1. Offline navigation correctness and warm-cache acknowledgement.
2. Maintenance validation, completion/rescheduling checks, consumable receipt/usage history and failure tests.
3. StoneOS branding and current handoff/year-run documentation.
4. Owner KPIs: collection ageing, stock ageing, block/variety costing, recovery/waste, machine productivity, fulfilment, customer/supplier comparisons; source links and honest missing-data flags.
5. Daily briefing, grounded English/Hindi answers, explainable alerts, collection priority, baseline forecasts, document review drafts.
6. Validate, review, merge and deploy to Oracle. Record final commit/schema and evidence.

Offsite backups are deferred by the user. All dry-run/testing writes stay isolated. Existing financial documents and owner credentials must be preserved. All schema changes are additive and nullable; roll back code without dropping data. Real AI/provider validation requires the owner's provider credential, entered securely in the product or server environment, never chat.
