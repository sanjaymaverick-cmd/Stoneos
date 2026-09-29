# Internal credentials

There is no Clerk, Supabase, or public signup. The first owner is created by a one-time bootstrap CLI that ships in the API image. Owners and managers issue staff usernames and temporary passwords. Passwords are scrypt hashes. Generated passwords force a change before any other write.

## Access lifecycle

Staff are not permanent, so disabling has to actually stick.

- **Revoking** deactivates the account and deletes every session row, so access
  stops on the next request rather than at the next login.
- **Re-issuing a username does not restore a disabled account.** It is refused.
  Doing otherwise reactivated the account with the old password still working,
  recorded only as a role change — a revocation undone with nothing to see.
- **Reactivation is its own act** (`POST /admin/users/:id/reactivate`) and issues
  a **new** password, returned once, with a forced change. An employee who left
  and came back never gets their old password back, so one written on a slip or
  shared while they were gone does not become live again.
- Both revoke and reactivate are audited under their own action names.

A temporary password buys nothing but the ability to replace it: every route is
refused until it is changed, except change-password, logout, and the `/auth/me`
the shell needs to render. Reads were previously allowed through, which opened
the CEO board, outstanding AR and the CSV exports to anyone holding a credential
slip that had never been used.
