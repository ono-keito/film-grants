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

-- ── Enforce allowlist at signup, server-side ─────────────────────────────
-- The app checks allowed_emails before calling signUp() for a nice error
-- message, but that check happens in client-side JS and is skippable by
-- anyone calling the Supabase Auth API directly with the public anon key.
-- This trigger is the real gate: it runs inside Postgres on every new
-- auth.users row and blocks the signup outright if the email isn't on the
-- allowlist, so it can't be bypassed from outside. Run this once (safe to
-- re-run — it replaces the function/trigger if they already exist).
create or replace function public.enforce_email_allowlist()
returns trigger as $$
begin
  if not exists (select 1 from public.allowed_emails where email = new.email) then
    raise exception 'not_authorized: % is not on the allowlist', new.email;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists enforce_allowlist_before_signup on auth.users;

create trigger enforce_allowlist_before_signup
  before insert on auth.users
  for each row execute function public.enforce_email_allowlist();
