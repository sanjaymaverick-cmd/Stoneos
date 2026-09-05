# Offline outbox with explicit conflicts

Clients may queue writes while offline. Retries use `clientOpId` idempotency keys. Inventory and money never last-write-wins: a version mismatch returns HTTP 409 and a visible conflict. Service workers must not cache API GET responses.
