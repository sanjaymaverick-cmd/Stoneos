# Offline outbox with explicit conflicts

Clients queue writes on network failure, not only when `navigator.onLine === false`. Each outbox item is bound to `userId` and `factoryId`; replay refuses a mismatch (shared-tablet honesty). Replay sends the stored `clientOpId` and never mints a new key. HTTP 400–499 except 409 are not retried. Retries are capped.

Stock and money writes never last-write-wins. When the client sends `baseVersion`, a mismatch returns HTTP 409 with `VERSION_CONFLICT` and the server row. Writes without `baseVersion` still use a transaction plus idempotency `(factoryId, clientOpId)`. Service workers must not cache API GET responses.
