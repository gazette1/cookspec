-- CookSpec initial schema. Written locally at scaffold time; apply to
-- the Supabase cloud project when it is provisioned.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  created_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  -- hash of the canonical source URL; repeat conversions of the same viral
  -- video hit this instead of paying for the pipeline again
  canonical_url_hash text unique,
  source_url text,
  source_type text not null check (
    source_type in ('tiktok', 'reel', 'shorts', 'youtube', 'article', 'text', 'image', 'dish_photo')
  ),
  source_platform text,
  creator_handle text,
  dish_name text not null,
  recipe_json jsonb not null,
  is_public boolean not null default true,
  is_inferred boolean not null default false,
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index recipes_owner_idx on public.recipes (owner_id);
create index recipes_public_created_idx on public.recipes (created_at desc) where is_public;

create table public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

-- one row per conversion attempt; drives the free daily cap and cost metrics
create table public.conversion_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  anon_key_hash text,
  recipe_id uuid references public.recipes (id) on delete set null,
  cache_hit boolean not null default false,
  cost_usd numeric(8, 4),
  created_at timestamptz not null default now()
);

create index conversion_events_user_idx on public.conversion_events (user_id, created_at desc);
create index conversion_events_anon_idx on public.conversion_events (anon_key_hash, created_at desc);

-- auto-create a profile row for each new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.saves enable row level security;
alter table public.conversion_events enable row level security;

create policy "profiles self read" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles self update" on public.profiles
  for update using ((select auth.uid()) = id);

create policy "recipes public or owner read" on public.recipes
  for select using (is_public or owner_id = (select auth.uid()));
create policy "recipes owner insert" on public.recipes
  for insert with check (owner_id = (select auth.uid()));
create policy "recipes owner update" on public.recipes
  for update using (owner_id = (select auth.uid()));
create policy "recipes owner delete" on public.recipes
  for delete using (owner_id = (select auth.uid()));

create policy "saves owner all" on public.saves
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- conversion_events has no policies on purpose: only the service role, which
-- bypasses RLS, reads or writes it.
