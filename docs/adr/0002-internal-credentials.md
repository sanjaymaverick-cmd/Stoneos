# Internal credentials

There is no Clerk, Supabase, or public signup. The first owner is created by a one-time bootstrap CLI that ships in the API image. Owners and managers issue staff usernames and temporary passwords. Passwords are scrypt hashes. Generated passwords force a change before any other write.
