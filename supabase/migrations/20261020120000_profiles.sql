-- Step 0.3: shared helpers and the `profiles` table (SPEC section 7).
-- Every table has RLS enabled (S-001); every policy is covered by tests in packages/db-tests.

-- Keeps `updated_at` in sync on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  role text not null default 'user' check (role in ('user', 'admin')),
  -- Set by the server when an account deletion is requested (F-004).
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- True when the current user is an administrator. `security definer` so that policies on
-- `profiles` can call it without recursing into their own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'admin' and deleted_at is null
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Creates the profile when an organiser signs up. Anonymous guest sessions (F-035) get none.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (user_id, display_name, locale)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 100), ''),
    case when requested_locale in ('fr', 'en') then requested_locale else 'fr' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  when (new.is_anonymous is not true)
  execute function public.handle_new_user();

-- Row Level Security.
alter table public.profiles enable row level security;

-- Visitors who are not signed in have no access at all.
revoke all on public.profiles from anon;

-- Signed-in users: read their own row, edit only their name and language.
-- `role` and `deleted_at` can only be changed by the server (service role).
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, locale) on public.profiles to authenticated;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_select_admin"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
