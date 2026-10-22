-- Step 3.3: moderation (F-070 to F-073) and the audit log of sensitive actions (SPEC 7, 9.2).
--
-- Who writes what:
--  * Hiding, restoring, approving, refusing and deleting media, and blocking a guest, are done by
--    the server with the service role after it checked the caller owns the event. Nothing new to
--    grant on `media` or `guests`.
--  * `reports` are CREATED by the server (a guest or a share link holder reports a photo) and
--    READ by the organiser of the event and by administrators. They are resolved by the server.
--  * `audit_log` is written by the server only and read by administrators only.

-- ---------------------------------------------------------------------------------------------
-- reports (F-073)
-- ---------------------------------------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media (id) on delete cascade,
  reason text not null check (reason in ('inappropriate', 'private', 'other')),
  -- A hash of who reported (guest session or address): one report per person and photo, and no
  -- identity kept (SPEC 7).
  reporter_fingerprint text not null check (reporter_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Set when the organiser dealt with it (dismissed, or the photo was hidden or deleted).
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (media_id, reporter_fingerprint)
);

create index reports_open_idx on public.reports (media_id) where resolved_at is null;

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;

create policy "reports_select_organiser"
  on public.reports for select to authenticated
  using (
    media_id in (
      select m.id from public.media m
       where m.event_id in (select id from public.events where owner_id = (select auth.uid()))
    )
  );

create policy "reports_select_admin"
  on public.reports for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Who did it: the signed-in user, or null for the system (scheduled tasks).
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) between 1 and 60),
  target_type text not null check (char_length(target_type) between 1 and 40),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "audit_log_select_admin"
  on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- media: moderation lists
-- ---------------------------------------------------------------------------------------------

-- The organiser's moderation lists page through every media of an event that is not deleted, newest
-- first, whatever its state.
create index media_moderation_idx
  on public.media (event_id, created_at desc, id desc)
  where status in ('ready', 'hidden');
