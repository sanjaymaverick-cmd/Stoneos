# ADR 0013 — Sister plants trade in StoneOS

## Status

Accepted. 2026-09-12. Reverses the 12 Sep Tally-only revert for group AR.

## Decision

Linked factories invoice each other in-app. Seller posts sales + AR. Buyer posts AP + a stock receipt on the buyer `factoryId`. Settlement is `SELECT FOR UPDATE` like ordinary pay and writes a receipt on the seller and a payment on the buyer. Distinct `clientOpId`s are prefixed by factory. Tally XML remains `writesInventory: false`.
