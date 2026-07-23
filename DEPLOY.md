# Deploying Sphere (free, email-gated)

This folder (`site/`) is a fully static app — no server to run or pay for.
Auth and your team's data live in Supabase (free tier); hosting is GitHub Pages (free).

## 1. Create the Supabase project (~3 min)

1. Go to https://supabase.com → sign up free → "New project."
2. Pick any name/region, set a database password (you won't need it day-to-day).
3. Once it's created: **SQL Editor** → "New query" → paste the entire contents of
   [`schema.sql`](schema.sql) → **Run**. This creates `access_requests`,
   `projects`, and `favorites` (plus a legacy unused `allowed_emails` table)
   with row-level security already locked down.
4. **Authentication → Providers → Email**: make sure "Email" is enabled
   (it is by default). If you'd like new accounts to be usable immediately
   after signup (no confirmation email step), turn **"Confirm email" off**
   here — otherwise each new person must click a link in their inbox once
   before their first sign-in works.
5. **Authentication → URL Configuration**: set **Site URL** to your GitHub
   Pages URL (e.g. `https://<your-username>.github.io/film-grants/`), and
   add the same URL under **Redirect URLs**. This matters for the
   "Forgot password?" email link and (if you kept it on) the signup
   confirmation email — without it, those links redirect to the wrong
   place (often `localhost`). If you don't know the exact URL yet, come
   back and set this after step 4 below.
6. **Settings → API**: copy the **Project URL** and the **anon public key**.

## 2. Make yourself the first admin

Anyone can now apply for access from the sign-in screen — there's no
pre-seeded allowlist to manage anymore. Instead:

1. Deploy the app (steps 3-4 below), then open it and click "Apply for
   access" using your own name/email/password. This creates your account
   and a `pending` row in `access_requests`.
2. Back in Supabase: **SQL Editor** → run this one line (with your email):
   ```sql
   update access_requests set status = 'approved', is_admin = true, reviewed_at = now()
   where email = 'you@example.com';
   ```
3. Sign in — you'll now see an **Applications** tab in the sidebar (visible
   only to admins) where you can approve or reject everyone else who
   applies. No further SQL needed after this one-time bootstrap.

## 3. Fill in your config

Open [`supabase-config.js`](supabase-config.js) and replace the two placeholder
values with what you copied in step 1:

```js
window.SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGci...';
```

The anon key is meant to be public — it's safe to commit to a public GitHub
repo. Security comes from the row-level security policies in `schema.sql`,
not from hiding this key.

## 4. Push to GitHub and turn on Pages

```bash
cd /Users/keitoono/Documents/Claude/grants/site
git init
git add .
git commit -m "Initial deploy"
git branch -M main
git remote add origin https://github.com/<your-username>/film-grants.git
git push -u origin main
```

(Create the empty repo on GitHub first at github.com/new — don't initialize
it with a README, since you're pushing one in.)

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch:
main, folder: / (root) → Save**. After a minute or two, your app is live at
`https://<your-username>.github.io/film-grants/`.

## 5. Share it

Send collaborators the URL. They'll see the sign-in screen, click "Apply
for access," and fill in their name/email/password — this creates their
account but doesn't grant access. You'll need to open the **Applications**
tab yourself (sign in as the admin from step 2) and click **Approve**.
Until then, they see a friendly "you're on the waitlist" screen instead
of the app. No emails are sent automatically — check the Applications
tab periodically, or ask people to let you know when they've applied.

## Updating the grant data later

`grants-data.json` in this folder is the single source of truth the app reads
from. Edit it and push to `main` — GitHub Pages redeploys automatically within
about a minute.
