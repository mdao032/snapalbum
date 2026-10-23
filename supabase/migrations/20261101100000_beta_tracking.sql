-- Step 6.3: follow-up of the field beta. The gate of phase 6 asks for a send success rate above
-- 99.5 %; the server can only see what reached it, so uploads that were reserved and never
-- confirmed (a closed tab, a lost phone) are counted per event before the hourly clean-up deletes
-- them (SPEC 9.2). Without this counter they would vanish from the figures.

alter table public.events
  add column uploads_abandoned integer not null default 0 check (uploads_abandoned >= 0);

-- ---------------------------------------------------------------------------------------------
-- bump_uploads_abandoned: called by the clean-up after it deleted `p_count` stale reservations
-- ---------------------------------------------------------------------------------------------
create or replace function public.bump_uploads_abandoned(p_event_id uuid, p_count integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.events
     set uploads_abandoned = uploads_abandoned + greatest(p_count, 0)
   where id = p_event_id;
$$;

revoke all on function public.bump_uploads_abandoned(uuid, integer) from public, anon, authenticated;
grant execute on function public.bump_uploads_abandoned(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- admin_overview: adds the uploads of the beta events (those that received the plan by invitation)
-- ---------------------------------------------------------------------------------------------
--   beta_uploads_delivered: reached the album (ready, hidden by moderation, or deleted afterwards
--     by the guest who had sent it)
--   beta_uploads_failed: refused by the checks (rejected) or never confirmed (abandoned)
-- Files still on their way (pending or uploaded, under a day old) are in neither.
create or replace function public.admin_overview(p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with beta_events as (
    select distinct pu.event_id as id
      from public.purchases pu
     where pu.source = 'beta_invitation' and pu.event_id is not null
  )
  select jsonb_build_object(
    'events_total', (select count(*) from public.events),
    'events_30d', (select count(*) from public.events where created_at >= p_now - interval '30 days'),
    'events_active', (select count(*) from public.events where status = 'active'),
    'events_suspended', (select count(*) from public.events where status = 'suspended'),
    'events_pending_deletion', (select count(*) from public.events where status = 'pending_deletion'),
    'events_paid', (
      select count(*) from public.events e
       where e.plan in ('event', 'pro')
         and not exists (select 1 from beta_events b where b.id = e.id)
    ),
    'events_beta', (select count(*) from beta_events),
    'beta_uploads_delivered', (
      select count(*) from public.media m
       where m.event_id in (select id from beta_events) and m.status in ('ready', 'hidden', 'deleted')
    ),
    'beta_uploads_failed', (
      (select count(*) from public.media m
        where m.event_id in (select id from beta_events) and m.status = 'rejected')
      + (select coalesce(sum(e.uploads_abandoned), 0) from public.events e
          where e.id in (select id from beta_events))
    ),
    'organisers_total', (select count(*) from public.profiles where deleted_at is null),
    'media_total', (select coalesce(sum(media_count), 0) from public.events),
    'media_30d', (
      select count(*) from public.media
       where created_at >= p_now - interval '30 days' and status in ('ready', 'hidden')
    ),
    'bytes_total', (select coalesce(sum(bytes_used), 0) from public.events),
    'revenue_cents', (select coalesce(sum(amount_cents), 0) from public.purchases where status = 'paid'),
    'purchases_paid', (
      select count(*) from public.purchases where status = 'paid' and source <> 'beta_invitation'
    ),
    'purchases_refunded', (select count(*) from public.purchases where status = 'refunded'),
    'open_reports', (select count(*) from public.reports where resolved_at is null)
  );
$$;
