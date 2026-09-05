# Opaque hashed sessions

Session tokens are random secrets. Only SHA-256 hashes are stored. Logout, password change, disable, and revoke-all delete session rows. JWTs were rejected: they are harder to audit and live as bearer secrets in browser storage.
