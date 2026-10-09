# Oracle release: dated openings and collection details

Released 9 October 2026. PR [42](https://github.com/sanjaymaverick-cmd/Stoneos/pull/42), code commit `15a98e80ab6550d0f5a564d42b9f13fa3dde21dd` (feature head `559bfa3723cd6b3edeb4119d3d59091bf1341915`). Local main and GitHub were synchronized before deploying. Oracle previously ran `35fb22d`.

## Behavior

[Opening balances](../opening-balances.md) supports arbitrary dated raw/WIP/finished stock, consumables, creditors/debtors, cash and bank without invoices. Rough/grinding/resin/polishing stages retain descriptive machine/location, with zero polished count until completion. Separate authorized approval and reconciliation are required; one approved general batch per factory. Opening dues support partial annotated receipts/payments. [Collection details](../customer-collection-details.md) supports later pending cash/bank clarification and invoice receipt notes, recipients and references.

Opening count date is independent of entry date. Reconstruct a historical snapshot and record subsequent movements separately; never double-open raw input and finished output from the same interval. Approved opening amounts and posted receipts remain immutable.

## Evidence

- Local API suite: 183/183, exit 0. Added WIP-stage isolated lifecycle: 1/1, exit 0.
- API/web typechecks and builds passed; web unit tests 21/21.
- Desktop/mobile browser workflows: 4/4, no retries, 390px and 1280px. Mocked API browser tests; database lifecycle separately tested with isolated PostgreSQL. Earlier local preview/encoding failures were corrected before the final passing run.
- PR CI run `37889895358`: quality, security, terraform validation, container images and fresh-runner restore all passed. No terraform apply.
- Deployment backup `/mnt/stoneos/backups/stoneos-20261009T054802Z.dump` (17M) verified readable; source-file archive also written.
- Oracle redeploy: build/migrate/replace exit 0, `DEPLOY_EXIT=0`; API/PostgreSQL healthy and internal readiness 200.
- 21 applied migrations, including `20261009120000_collection_details` and `20261009140000_general_opening_balances`.
- Running API service hashes match local release source for openings, sales and party reports. Compiled web opening page exists.
- Public HTTPS login, opening page and Sales: 200. Opening API without authentication: 401.
- Pre/post counts and content checksums matched for raw blocks (531), slabs (29064), customers (4), suppliers (3), invoices (161), payments (160), sales orders (265), vouchers (2229), voucher lines (6050), consumables (13), consumable movements (2486). Comparison excludes additive receipt/customer fields. No production test entries were written; opening batches and settlements both remain zero.

Offsite backup and backup timer remain unconfigured, as before. Application rollback may retain the new schema; never drop opening or receipt data. Previous deployment commit is also saved by the server in `/tmp/stoneos-previous-commit`.
