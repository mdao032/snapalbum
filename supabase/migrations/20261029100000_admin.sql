-- Step 5.3: administrator area (F-090, F-091, F-092, SPEC 9.3).
--
-- Who writes what: everything here is read and done by the server with the service role, after it
-- has checked that the caller is an administrator (`profiles.role = 'admin'`). Nothing is granted to
-- organisers, guests or visitors. These functions exist so that lists and figures are computed in
-- the database (a page of 25 rows with the organiser's e-mail address needs `auth.users`, which the
-- API does not expose) and so that each action is one transaction with its audit line.

-- ---------------------------------------------------------------------------------------------
-- admin_overview: the figures of the platform (F-092)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_overview(p_now timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'events_total', (select count(*) from public.events),
    'events_30d', (select count(*) from public.events where created_at >= p_now - interval '30 days'),
    'events_active', (select count(*) from public.events where status = 'active'),
    'events_suspended', (select count(*) from public.events where status = 'suspended'),
    'events_pending_deletion', (select count(*) from public.events where status = 'pending_deletion'),
    'events_paid', (select count(*) from public.events where plan in ('event', 'pro')),
    'organisers_total', (select count(*) from public.profiles where deleted_at is null),
    'media_total', (select coalesce(sum(media_count), 0) from public.events),
    'media_30d', (
      select count(*) from public.media
       where created_at >= p_now - interval '30 days' and status in ('ready', 'hidden')
    ),
    'bytes_total', (select coalesce(sum(bytes_used), 0) from public.events),
    'revenue_cents', (select coalesce(sum(amount_cents), 0) from public.purchases where status = 'paid'),
    'purchases_paid', (select count(*) from public.purchases where status = 'paid'),
    'purchases_refunded', (select count(*) from public.purchases where status = 'refunded'),
    'open_reports', (select count(*) from public.reports where resolved_at is null)
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_list_events (F-090)
-- ---------------------------------------------------------------------------------------------
-- A page of events, newest first, with their organiser's address and their open reports. The
-- search is a plain "contains" on the title, the organiser's address and the name, or the exact
-- public code: no wildcard of the visitor's is ever interpreted.
create or replace function public.admin_list_events(p_query text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_total bigint;
  v_rows jsonb;
begin
  select count(*) into v_total
    from public.events e
    left join auth.users u on u.id = e.owner_id
   where v_query is null
      or position(v_query in lower(e.title)) > 0
      or position(v_query in lower(coalesce(u.email, ''))) > 0
      or lower(e.public_code) = v_query;

  select coalesce(jsonb_agg(row_to_json(page)), '[]'::jsonb) into v_rows
    from (
      select e.id, e.title, e.public_code, e.status, e.plan, e.event_date, e.created_at,
             e.expires_at, e.media_count, e.bytes_used, e.owner_id, u.email as owner_email,
             (select count(*) from public.reports r
                join public.media m on m.id = r.media_id
               where m.event_id = e.id and r.resolved_at is null) as open_reports
        from public.events e
        left join auth.users u on u.id = e.owner_id
       where v_query is null
          or position(v_query in lower(e.title)) > 0
          or position(v_query in lower(coalesce(u.email, ''))) > 0
          or lower(e.public_code) = v_query
       order by e.created_at desc, e.id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_list_organisers (F-090)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_organisers(p_query text, p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_total bigint;
  v_rows jsonb;
begin
  select count(*) into v_total
    from public.profiles p
    left join auth.users u on u.id = p.user_id
   where v_query is null
      or position(v_query in lower(coalesce(u.email, ''))) > 0
      or position(v_query in lower(coalesce(p.display_name, ''))) > 0;

  select coalesce(jsonb_agg(row_to_json(page)), '[]'::jsonb) into v_rows
    from (
      select p.user_id, u.email, p.display_name, p.locale, p.role, p.created_at, p.deleted_at,
             (select count(*) from public.events e where e.owner_id = p.user_id) as events_count,
             (select coalesce(sum(pu.amount_cents), 0) from public.purchases pu
               where pu.user_id = p.user_id and pu.status = 'paid') as paid_cents
        from public.profiles p
        left join auth.users u on u.id = p.user_id
       where v_query is null
          or position(v_query in lower(coalesce(u.email, ''))) > 0
          or position(v_query in lower(coalesce(p.display_name, ''))) > 0
       order by p.created_at desc, p.user_id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_list_purchases (F-090)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_purchases(p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_rows jsonb;
begin
  select count(*) into v_total from public.purchases;

  select coalesce(jsonb_agg(row_to_json(page)), '[]'::jsonb) into v_rows
    from (
      select pu.id, pu.event_id, pu.event_title, pu.product, pu.amount_cents, pu.currency,
             pu.status, pu.created_at, pu.refunded_at, pu.stripe_payment_intent_id,
             u.email as owner_email
        from public.purchases pu
        left join auth.users u on u.id = pu.user_id
       order by pu.created_at desc, pu.id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_set_event_suspended (F-091)
-- ---------------------------------------------------------------------------------------------
-- An active event is suspended (guests no longer see it, uploads stop, nothing is deleted); a
-- suspended one is lifted. Any other state is left alone.
--   { "ok": false }
--   { "ok": true, "status": "suspended" | "active" }
create or replace function public.admin_set_event_suspended(
  p_event_id uuid,
  p_suspended boolean,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.events
     set status = case when p_suspended then 'suspended' else 'active' end
   where id = p_event_id
     and status = case when p_suspended then 'active' else 'suspended' end
  returning status into v_status;
  if v_status is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_actor, case when p_suspended then 'admin.event.suspend' else 'admin.event.unsuspend' end,
          'event', p_event_id, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_extend_event (F-091)
-- ---------------------------------------------------------------------------------------------
-- Adds months of conservation to an active or suspended event, without payment (a gesture of the
-- administrator): from the current expiry, or from now if it has passed. Pro events do not expire.
--   { "ok": false }
--   { "ok": true, "expires_at": "..." }
create or replace function public.admin_extend_event(
  p_event_id uuid,
  p_months integer,
  p_actor uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_months < 1 or p_months > 24 then
    return jsonb_build_object('ok', false);
  end if;

  update public.events
     set expires_at = greatest(coalesce(expires_at, p_now), p_now) + make_interval(months => p_months)
   where id = p_event_id and status in ('active', 'suspended') and plan <> 'pro'
  returning expires_at into v_expires;
  if v_expires is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_actor, 'admin.event.extend', 'event', p_event_id,
          jsonb_build_object('months', p_months, 'expires_at', v_expires));
  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_emails: where to write to the administrators (SPEC 9.3 alert)
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_contacts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'locale', p.locale)), '[]'::jsonb)
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.role = 'admin' and p.deleted_at is null and u.email is not null;
$$;

revoke all on function public.admin_overview(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_overview(timestamptz) to service_role;
revoke all on function public.admin_list_events(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_events(text, integer, integer) to service_role;
revoke all on function public.admin_list_organisers(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_organisers(text, integer, integer) to service_role;
revoke all on function public.admin_list_purchases(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_purchases(integer, integer) to service_role;
revoke all on function public.admin_set_event_suspended(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_event_suspended(uuid, boolean, uuid) to service_role;
revoke all on function public.admin_extend_event(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_extend_event(uuid, integer, uuid, timestamptz) to service_role;
revoke all on function public.admin_contacts() from public, anon, authenticated;
grant execute on function public.admin_contacts() to service_role;
