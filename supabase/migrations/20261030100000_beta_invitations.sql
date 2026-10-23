-- Step 6.1: field beta (phase 6). An administrator invites an organiser by e-mail address and gets a
-- single-use code; the organiser enters it on one of their free events and receives the Event plan
-- without paying (same retention, same quotas). Nothing here is reachable by organisers, guests or
-- visitors: the server calls these functions with the service role, after its own checks.

-- ---------------------------------------------------------------------------------------------
-- beta_invitations
-- ---------------------------------------------------------------------------------------------
create table public.beta_invitations (
  id uuid primary key default gen_random_uuid(),
  -- 10 characters without the look-alikes (0/O, 1/I/L), shown by the app in two groups of five.
  code text not null unique check (code ~ '^[A-HJ-KM-NP-Z2-9]{10}$'),
  -- The organiser the code was made for: it only works for the account with this address.
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  -- Kept for the history once the event is gone.
  event_title text
);

-- One open invitation per address at a time (a new one is possible once it was used or revoked).
create unique index beta_invitations_open_email_idx
  on public.beta_invitations (email)
  where redeemed_at is null and revoked_at is null;
create index beta_invitations_created_idx on public.beta_invitations (created_at desc);

alter table public.beta_invitations enable row level security;
-- No policy: the table is closed to the API; only the service role reads and writes it.
revoke all on public.beta_invitations from anon, authenticated;

-- A purchase that came from an invitation is not a payment (revenue and conversion leave it out).
alter table public.purchases drop constraint purchases_source_check;
alter table public.purchases
  add constraint purchases_source_check
  check (source in ('stripe', 'app_store', 'google_play', 'beta_invitation'));

-- ---------------------------------------------------------------------------------------------
-- create_beta_invitation
-- ---------------------------------------------------------------------------------------------
--   { "ok": false, "reason": "invalid_input" | "already_invited" | "duplicate_code" }
--   { "ok": true, "id": uuid }
-- The code is drawn by the server (a random source the database does not have in a form worth
-- trusting for this); a clash with an existing code is reported so that the server draws another.
create or replace function public.create_beta_invitation(p_actor uuid, p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+$' or p_code !~ '^[A-HJ-KM-NP-Z2-9]{10}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  if exists (select 1 from public.beta_invitations where code = p_code) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_code');
  end if;
  if exists (
    select 1 from public.beta_invitations
     where email = v_email and redeemed_at is null and revoked_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_invited');
  end if;

  insert into public.beta_invitations (code, email, created_by)
  values (p_code, v_email, p_actor)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_actor, 'admin.beta.invite', 'beta_invitation', v_id, jsonb_build_object('email', v_email));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- revoke_beta_invitation: an unused code stops working
-- ---------------------------------------------------------------------------------------------
--   { "ok": false } when the invitation does not exist, was used or is already revoked
create or replace function public.revoke_beta_invitation(p_actor uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.beta_invitations
     set revoked_at = now()
   where id = p_id and redeemed_at is null and revoked_at is null;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_actor, 'admin.beta.revoke', 'beta_invitation', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- redeem_beta_invitation: the code gives the Event plan to one free event
-- ---------------------------------------------------------------------------------------------
--   { "ok": false, "reason": "invalid_code" | "already_used" | "revoked" | "event_not_found"
--                         | "not_free" | "event_not_active" }
--   { "ok": true, "plan": ..., "expires_at": ... }
-- A code that does not exist and a code made for someone else both answer `invalid_code`: nobody
-- learns that a code is real. The plan is applied by `apply_purchase`, the function a payment
-- uses, so that retention and revival of an expired event stay in one place.
create or replace function public.redeem_beta_invitation(
  p_user_id uuid,
  p_event_id uuid,
  p_code text,
  p_months integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.beta_invitations;
  v_email text;
  v_event public.events;
  v_applied jsonb;
  v_session text;
begin
  select lower(email) into v_email from auth.users where id = p_user_id;

  select * into v_invitation from public.beta_invitations where code = p_code for update;
  if not found or v_email is null or v_invitation.email <> v_email then
    return jsonb_build_object('ok', false, 'reason', 'invalid_code');
  end if;
  if v_invitation.redeemed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_invitation.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  select * into v_event from public.events where id = p_event_id and owner_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;
  if v_event.plan <> 'free' then
    return jsonb_build_object('ok', false, 'reason', 'not_free');
  end if;
  if v_event.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'event_not_active');
  end if;

  v_session := 'beta:' || v_invitation.id::text;
  v_applied := public.apply_purchase(
    p_event_id, p_user_id, v_session, null, 0, 'eur', 'event', p_months, null, null
  );
  if not coalesce((v_applied ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', coalesce(v_applied ->> 'reason', 'event_not_found'));
  end if;

  -- The purchase is a gift, not a Stripe payment: say so, and free the Stripe column.
  update public.purchases
     set source = 'beta_invitation', stripe_checkout_session_id = null
   where stripe_checkout_session_id = v_session;

  update public.beta_invitations
     set redeemed_at = now(), redeemed_by = p_user_id, event_id = p_event_id,
         event_title = v_event.title
   where id = v_invitation.id;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_user_id, 'beta.redeem', 'event', p_event_id,
          jsonb_build_object('invitation', v_invitation.id));
  return jsonb_build_object('ok', true, 'plan', v_applied ->> 'plan',
                            'expires_at', v_applied ->> 'expires_at');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_list_beta_invitations
-- ---------------------------------------------------------------------------------------------
create or replace function public.admin_list_beta_invitations(p_limit integer, p_offset integer)
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
  select count(*) into v_total from public.beta_invitations;

  select coalesce(jsonb_agg(row_to_json(page)), '[]'::jsonb) into v_rows
    from (
      select bi.id, bi.code, bi.email, bi.created_at, bi.revoked_at, bi.redeemed_at,
             bi.event_id, bi.event_title,
             case
               when bi.redeemed_at is not null then 'redeemed'
               when bi.revoked_at is not null then 'revoked'
               else 'open'
             end as state
        from public.beta_invitations bi
       order by bi.created_at desc, bi.id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_overview: beta events are counted apart (they are not paying customers)
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
    'events_paid', (
      select count(*) from public.events e
       where e.plan in ('event', 'pro')
         and not exists (
           select 1 from public.purchases pu
            where pu.event_id = e.id and pu.source = 'beta_invitation'
         )
    ),
    'events_beta', (
      select count(distinct pu.event_id) from public.purchases pu
       where pu.source = 'beta_invitation' and pu.event_id is not null
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

-- admin_list_purchases already lists every purchase; it now says where it came from.
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
      select pu.id, pu.event_id, pu.event_title, pu.product, pu.source, pu.amount_cents,
             pu.currency, pu.status, pu.created_at, pu.refunded_at, pu.stripe_payment_intent_id,
             u.email as owner_email
        from public.purchases pu
        left join auth.users u on u.id = pu.user_id
       order by pu.created_at desc, pu.id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.create_beta_invitation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_beta_invitation(uuid, text, text) to service_role;
revoke all on function public.revoke_beta_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_beta_invitation(uuid, uuid) to service_role;
revoke all on function public.redeem_beta_invitation(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.redeem_beta_invitation(uuid, uuid, text, integer) to service_role;
revoke all on function public.admin_list_beta_invitations(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_beta_invitations(integer, integer) to service_role;
