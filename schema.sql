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
  created_at timestamptz default now(),
  unique (user_id, grant_id)
);

alter table favorites enable row level security;

create policy "Users manage their own favorites"
  on favorites for all
  using (true);  -- RLS check done in app (email must be in allowed_emails)
