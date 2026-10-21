-- Step 1.2: events (SPEC section 7, F-010 to F-016).
--
-- Who writes what:
--  * Organisers READ their own events and UPDATE only the presentation fields (title, language,
--    welcome message, accent color, cover, settings). RLS + column privileges enforce it.
--  * Everything that carries a business rule (creation and its quota, event date and expiry,
--    plan, status, counters, public code) is written by the server with the service role, after
--    checking the caller's rights. Organisers can never touch those columns.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  -- `restrict`: deleting an account must go through the purge flow (storage first), never cascade.
  owner_id uuid not null references auth.users (id) on delete restrict,
  public_code text not null unique
    check (public_code ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{10,}$'),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  event_date date not null,
  type text not null check (type in ('wedding', 'birthday', 'corporate', 'other')),
  locale text not null default 'fr' check (locale in ('fr', 'en')),
  cover_media_key text,
  welcome_message text check (welcome_message is null or char_length(welcome_message) <= 500),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$'),
  plan text not null default 'free' check (plan in ('free', 'event', 'pro')),
  -- gallery_visible, require_approval, upload_opens_at, upload_closes_at, access_code_hash.
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  media_count integer not null default 0 check (media_count >= 0),
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  -- When media are deleted. Null: no scheduled expiry (subscription plan, phase 8).
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended', 'pending_deletion')),
  -- Set when the organiser asks for deletion (R5: purged after 7 days unless cancelled).
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_owner_id_idx on public.events (owner_id);
create index events_expires_at_idx on public.events (expires_at) where expires_at is not null;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

alter table public.events enable row level security;

revoke all on public.events from anon;
revoke all on public.events from authenticated;
grant select on public.events to authenticated;
grant update (title, type, locale, welcome_message, accent_color, cover_media_key, settings)
  on public.events to authenticated;

create policy "events_select_own"
  on public.events for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "events_select_admin"
  on public.events for select to authenticated
  using ((select public.is_admin()));

-- An organiser edits their own event only while it is active (not suspended nor being deleted).
create policy "events_update_own_active"
  on public.events for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'active')
  with check (owner_id = (select auth.uid()) and status = 'active');
