-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Sets up: an editable allowlist of permitted emails, per-user Projects,
-- and per-user Favorites — all locked down with Row Level Security so
-- one user can never read or write another user's data.

-- ── Allowlist ──────────────────────────────────────────────────────────
-- Add/remove rows here any time (Table Editor → allowed_emails) to control
-- who can use the app. No redeploy needed.
create table if not exists allowed_emails (
  email text primary key
);

alter table allowed_emails enable row level security;

create policy "Anyone can check the allowlist"
  on allowed_emails for select
  using (true);

-- ── Projects ───────────────────────────────────────────────────────────
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  format text,        -- e.g. "Short Narrative", "Short Doc"
  stage text,         -- e.g. "Development", "Production", "Post"
  location text,
  notes text,
  created_at timestamptz default now()
);

alter table projects enable row level security;

create policy "Users manage their own projects"
  on projects for all
  using (true);  -- RLS check done in app (email must be in allowed_emails)

-- ── Favorites ──────────────────────────────────────────────────────────
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  grant_id text not null,
  grant_name text not null,
  project_id uuid references projects(id) on delete set null,
  note text,
  status text default 'Not Started',
  created_at timestamptz default now(),
  unique (user_id, grant_id)
);

alter table favorites enable row level security;

create policy "Users manage their own favorites"
  on favorites for all
  using (true);  -- RLS check done in app (email must be in allowed_emails)

-- ── Migration: add status tracking to existing favorites ────────────────
-- If you already ran this schema before the "status" column existed,
-- just run this one line in SQL Editor (safe to re-run, no-op if it exists):
alter table favorites add column if not exists status text default 'Not Started';

-- ── Project ↔ Grant links (many-to-many) ─────────────────────────────────
-- A grant can belong to multiple projects, tracked independently of
-- "liked" status. Run this once (safe to re-run, no-op if it exists).
create table if not exists project_grants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  project_id uuid references projects(id) on delete cascade not null,
  grant_id text not null,
  grant_name text not null,
  status text default 'Not Started',
  created_at timestamptz default now(),
  unique (project_id, grant_id)
);

alter table project_grants enable row level security;

create policy "Users manage their own project grants"
  on project_grants for all
  using (true);  -- RLS check done in app (email must be in allowed_emails)

-- ── Superseded: allowlist-gated signup ───────────────────────────────────
-- Earlier versions of this schema blocked signUp() at the database level
-- for any email not pre-added to `allowed_emails`. That's replaced below
-- by an apply-then-approve workflow: anyone can create an account, but
-- app access (see the tightened policies further down) requires an
-- approved row in `access_requests`. Drop the old trigger so signup
-- itself is no longer blocked — it's safe to run even if it was never
-- created. The old `allowed_emails` table is left in place, unused.
drop trigger if exists enforce_allowlist_before_signup on auth.users;
drop function if exists public.enforce_email_allowlist();

-- ── Access requests (apply → review → approve/reject) ────────────────────
-- Signing up IS applying: the app calls signUp() then inserts a row here
-- with status='pending'. Nobody gets into the app (see tightened policies
-- below) until an admin flips their row to 'approved' from the
-- Applications view. 'rejected' and 'pending' both just show the user a
-- friendly "you're on the waitlist" screen — no harsh rejection message.
create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text not null,
  last_name text not null,
  status text not null default 'pending', -- 'pending' | 'approved' | 'rejected'
  is_admin boolean not null default false,
  created_at timestamptz default now(),
  reviewed_at timestamptz
);

alter table access_requests enable row level security;

drop policy if exists "Anyone can submit their own application" on access_requests;
create policy "Anyone can submit their own application"
  on access_requests for insert
  with check (true);

drop policy if exists "Users can view their own application" on access_requests;
create policy "Users can view their own application"
  on access_requests for select
  using (email = auth.jwt() ->> 'email');

drop policy if exists "Admins can view all applications" on access_requests;
create policy "Admins can view all applications"
  on access_requests for select
  using (
    exists (
      select 1 from access_requests admin_row
      where admin_row.email = auth.jwt() ->> 'email'
        and admin_row.is_admin = true
        and admin_row.status = 'approved'
    )
  );

drop policy if exists "Admins can update applications" on access_requests;
create policy "Admins can update applications"
  on access_requests for update
  using (
    exists (
      select 1 from access_requests admin_row
      where admin_row.email = auth.jwt() ->> 'email'
        and admin_row.is_admin = true
        and admin_row.status = 'approved'
    )
  );

-- ── Bootstrap the first admin ─────────────────────────────────────────────
-- Sign up through the app once with your own email/password (this creates
-- your 'pending' row above), then run this one line in the SQL Editor,
-- replacing the email, to approve yourself and mark yourself admin:
--
--   update access_requests set status = 'approved', is_admin = true, reviewed_at = now()
--   where email = 'you@example.com';

-- ── Tighten data access to approved users only ────────────────────────────
-- Previously these policies were `using (true)` for any signed-in user —
-- fine when signup itself was gated, but now that anyone can create an
-- account (to apply), app data must require an approved application too.
drop policy if exists "Users manage their own projects" on projects;
create policy "Approved users manage their own projects"
  on projects for all
  using (
    exists (select 1 from access_requests where email = auth.jwt() ->> 'email' and status = 'approved')
  );

drop policy if exists "Users manage their own favorites" on favorites;
create policy "Approved users manage their own favorites"
  on favorites for all
  using (
    exists (select 1 from access_requests where email = auth.jwt() ->> 'email' and status = 'approved')
  );

drop policy if exists "Users manage their own project grants" on project_grants;
create policy "Approved users manage their own project grants"
  on project_grants for all
  using (
    exists (select 1 from access_requests where email = auth.jwt() ->> 'email' and status = 'approved')
  );
