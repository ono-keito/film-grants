# Deploying Sphere (free, email-gated)

This folder (`site/`) is a fully static app — no server to run or pay for.
Auth and your team's data live in Supabase (free tier); hosting is GitHub Pages (free).

## 1. Create the Supabase project (~3 min)

1. Go to https://supabase.com → sign up free → "New project."
2. Pick any name/region, set a database password (you won't need it day-to-day).
3. Once it's created: **SQL Editor** → "New query" → paste the entire contents of
   [`schema.sql`](schema.sql) → **Run**. This creates the `allowed_emails`,
   `projects`, and `favorites` tables with row-level security already locked down.
4. **Authentication → Providers → Email**: make sure "Email" is enabled
   (it is by default). Magic-link sign-in needs no extra setup.
5. **Settings → API**: copy the **Project URL** and the **anon public key**.

## 2. Add yourself (and collaborators) to the allowlist

In Supabase: **Table Editor → allowed_emails → Insert row** → paste an email →
Save. Repeat for every person who should have access. You can add or remove
people here any time — no redeploy needed. Anyone not on this list who tries
to sign in gets a clean "not authorized" message and no access to any data.

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

Send collaborators the URL. They'll see the sign-in screen, enter their email,
click the magic link sent to their inbox, and land in the app — but only if
their email is in `allowed_emails` (step 2). Anyone else gets bounced with a
clear message.

## Updating the grant data later

`grants-data.json` in this folder is the single source of truth the app reads
from. Edit it and push to `main` — GitHub Pages redeploys automatically within
about a minute.
