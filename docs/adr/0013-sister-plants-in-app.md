# ADR 0013 — Sister yards are ordinary firms

## Status

Superseded 2026-09-13. In-app interfactory trade is removed.

## Decision

A sister plant is a customer or supplier like any other firm. Sell with the normal invoice/pay/CN path. Buy with the normal expense/purchase path. Do not link factories, copy slabs across `factoryId`, or post a second ledger on the other yard.

Isolation stays `WHERE factoryId = session.factoryId`. Tally XML remains an archive log (`writesInventory: false`).
