# Internal credentials

There is no Clerk, Supabase, or public signup. The first owner is created by a one-time bootstrap CLI that ships in the API image. The owner issues staff usernames and temporary passwords. Passwords are scrypt hashes. Generated passwords force a change before any other write.

## Who may act on whose account

Handing out a rank is the owner's alone. Creating an account and changing an
existing one's role are the same call and both set a rank, so both are refused
to everyone else — a manager who could mint roles could mint a second manager,
or promote a deputy past the people they were hired under, and the hierarchy
would only ever be as firm as the most junior person allowed to edit it.

Everything that does not set a rank — reset a password, disable, reactivate —
follows the chain of command strictly downward:

| | owner | manager | admin | supervisor | specialists |
|---|---|---|---|---|---|
| **owner** | yes¹ | yes | yes | yes | yes |
| **manager** | no | no | yes | yes | yes |
| everyone else | no | no | no | no | no |

¹ An owner may act on a co-owner but not revoke their own owner account.

A manager reaching sideways is the case worth naming: two managers who disagree
must not be able to settle it by switching each other off. Specialist roles
(accountant, auditor, sales, inventory, operator) are level with one another for
the same reason — an accountant is not above a storekeeper, they answer to
different people about different things. Admin is a desk, not a rung: it
configures the system and manages nobody.

A consequence worth stating plainly: **onboarding is the owner's job.** A
manager can keep the roster running — reset a forgotten password, disable
someone who walked off, bring them back — but a new hire's login comes from the
owner, and so does every promotion.

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

There is deliberately **no expiry date on an account**. Employment here has no
predefined period — some staff stay ten days, some ten months — so any date set
at issue would be a guess, and a wrong guess locks someone out mid-shift. Access
ends when the owner ends it, and not before. Do not add automatic expiry without
that decision being revisited.

## Login lockout

Per account, counted in the database so a restart does not hand an attacker a
fresh counter. Two rounds:

1. **10 consecutive wrong passwords → locked for 5 minutes.** The account stays
   active; the correct password is refused for the duration and says how long is
   left. A successful login at any point resets the counter to zero, so someone
   who mistypes on Monday and gets in on Tuesday is not one bad morning from
   suspension.
2. **5 more wrong passwords after that lock expires → suspended.** `active` goes
   false, live sessions are deleted, and only the owner issuing new credentials
   (reactivate, or a password reset) brings it back.

**Failures during a lock are refused without counting.** This matters more than it
looks: if they counted, the cooldown would be the fastest route to the suspend
threshold, and anyone who knew a username could burn the account down in a single
burst. The test pins this.

`suspendedAt` is what distinguishes a lockout suspension from an owner's
deliberate revocation — both leave `active = false`, so every existing guard
(including `provision()` refusing to quietly re-enable a disabled account) already
applies to both. Issuing new credentials clears the whole slate: counters, timer,
and the suspension flag.

The messages are deliberately asymmetric. Before the password is verified, every
refusal is the same `Invalid username or password`, so the endpoint is not a
username oracle and does not report account state to someone who cannot
authenticate. Once the **correct** password is supplied, the refusal names the
cause — that person has proved they are the account holder, and telling them
"ask the owner for new credentials" costs nothing.

### The owner is not exempt, and that needs a way back in

The policy applies to every account, the owner's included: an owner's password is
the most valuable one here, so exempting it would put the lockout where it is
least useful. The consequence is real, though — **anyone who knows the owner's
username can suspend it in fifteen wrong guesses**, and a suspended sole owner has
nobody left in the app who can issue them new credentials.

So the way back does not go through the app:

```
docker compose exec api npx tsx src/unlock.ts <username>
```

It clears the counters, lifts the lock, un-suspends, prints a new temporary
password, and audits itself as `auth.unlock_cli`. It needs shell access to the
server, which is a fair bar for the one account that can do everything.

If that trade is wrong for this site — if a remote stranger being able to force an
SSH session is worse than the owner's password having a weaker lock — the
alternative is to exempt owners from step 2 and let them re-lock for 5 minutes
indefinitely. That is a one-line change and a decision, not a design constraint.


A temporary password buys nothing but the ability to replace it: every route is
refused until it is changed, except change-password, logout, and the `/auth/me`
the shell needs to render. Reads were previously allowed through, which opened
the CEO board, outstanding AR and the CSV exports to anyone holding a credential
slip that had never been used.
