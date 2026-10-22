-- Step 4.3: life cycle of an event and e-mails (SPEC 9.2, 14).
--
-- Who writes what: everything here is done by the server with the service role, from scheduled
-- tasks and from the places that send e-mails. Nothing is granted to organisers or guests.

-- ---------------------------------------------------------------------------------------------
-- events.deletion_reason: why an event is waiting to be purged
-- ---------------------------------------------------------------------------------------------
-- 'user': the organiser asked for it (R5), and can cancel for 7 days.
-- 'expired': its conservation ran out (SPEC 9.2). It cannot be "cancelled": it is brought back by
-- a payment (event plan or extension) during the 7 days, or purged.
alter table public.events
  add column deletion_reason text check (deletion_reason in ('user', 'expired'));

update public.events set deletion_reason = 'user' where status = 'pending_deletion';

create index events_purge_idx on public.events (deleted_at) where status = 'pending_deletion';

-- ---------------------------------------------------------------------------------------------
-- email_log: each automatic e-mail is sent once
-- ---------------------------------------------------------------------------------------------
-- A task that runs twice, two servers answering at once, a retry after a failure: the first one
-- to "claim" an e-mail sends it, the others find the line and stop. `recipient_key` identifies the
-- recipient without keeping an address (an account or guest identifier, a purchase identifier).
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (char_length(kind) between 1 and 40),
  event_id uuid not null references public.events (id) on delete cascade,
  recipient_key text not null check (char_length(recipient_key) between 1 and 100),
  status text not null default 'claimed' check (status in ('claimed', 'sent')),
  provider text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, event_id, recipient_key)
);

create trigger email_log_set_updated_at
  before update on public.email_log
  for each row execute function public.set_updated_at();

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;

-- Takes the right to send one e-mail. False when it was already sent, or is being sent right now;
-- a claim older than `p_stale_minutes` (a task that died halfway) is taken over.
create or replace function public.claim_email(
  p_kind text,
  p_event_id uuid,
  p_recipient text,
  p_stale_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.email_log (kind, event_id, recipient_key)
  values (p_kind, p_event_id, p_recipient)
  on conflict (kind, event_id, recipient_key) do update set status = 'claimed'
    where public.email_log.status = 'claimed'
      and public.email_log.updated_at < now() - make_interval(mins => p_stale_minutes)
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- Marks a claimed e-mail as sent.
create or replace function public.finish_email(
  p_kind text,
  p_event_id uuid,
  p_recipient text,
  p_provider text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_log
     set status = 'sent', provider = p_provider, sent_at = now()
   where kind = p_kind and event_id = p_event_id and recipient_key = p_recipient;
$$;

-- Gives a claim back after a failed send, so the next run tries again.
create or replace function public.release_email(
  p_kind text,
  p_event_id uuid,
  p_recipient text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.email_log
   where kind = p_kind and event_id = p_event_id and recipient_key = p_recipient
     and status = 'claimed';
$$;

-- ---------------------------------------------------------------------------------------------
-- expire_due_events: conservation ran out (SPEC 9.2)
-- ---------------------------------------------------------------------------------------------
-- In ONE statement: the events whose `expires_at` has passed leave the guests' sight and start
-- their 7 days before the purge; the e-mail addresses guests left for the album link are erased
-- (SPEC 7, RGPD); every expiry leaves a line in the audit log.
--   { "expired": ["<event id>", ...] }
create or replace function public.expire_due_events(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  with due as (
    update public.events
       set status = 'pending_deletion', deleted_at = p_now, deletion_reason = 'expired'
     where status = 'active' and plan <> 'pro'
       and expires_at is not null and expires_at <= p_now
    returning id, media_count, bytes_used, plan
  ), erased as (
    update public.guests
       set notify_email = null, notify_consent_at = null
     where event_id in (select id from due)
       and (notify_email is not null or notify_consent_at is not null)
    returning 1
  ), logged as (
    insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
    select null, 'event_expired', 'event', id,
           jsonb_build_object('media_count', media_count, 'bytes_used', bytes_used, 'plan', plan)
      from due
    returning 1
  )
  select coalesce(array_agg(id), '{}') into v_ids from due;

  return jsonb_build_object('expired', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- purge_event: the database side of a purge (the storage is emptied first, by the server)
-- ---------------------------------------------------------------------------------------------
-- Deletes an event that waits for its purge, with everything that hangs from it (media, guests,
-- share links, reports, e-mail log) and writes the audit line in the same transaction. Purchases
-- stay: they are accounting records. A purge never touches an event that is not waiting for it.
--   { "ok": false }  not found, or not waiting for deletion
--   { "ok": true, "media_count": n, "bytes_used": n, "guest_users": ["<auth user id>", ...] }
create or replace function public.purge_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_guest_users uuid[];
begin
  select * into v_event from public.events
   where id = p_event_id and status = 'pending_deletion' for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(array_agg(auth_user_id), '{}') into v_guest_users
    from public.guests where event_id = p_event_id;

  delete from public.events where id = p_event_id;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (null, 'event_purged', 'event', p_event_id,
          jsonb_build_object('media_count', v_event.media_count, 'bytes_used', v_event.bytes_used,
                             'plan', v_event.plan, 'reason', v_event.deletion_reason));

  return jsonb_build_object('ok', true, 'media_count', v_event.media_count,
                            'bytes_used', v_event.bytes_used, 'guest_users', to_jsonb(v_guest_users));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- apply_purchase: a payment during the 7 days brings an expired event back
-- ---------------------------------------------------------------------------------------------
-- Same function as in step 4.2, with one addition: an event that expired (not one the organiser
-- deleted on purpose) becomes active again when it is paid for.
create or replace function public.apply_purchase(
  p_event_id uuid,
  p_user_id uuid,
  p_session_id text,
  p_payment_intent text,
  p_amount_cents integer,
  p_currency text,
  p_product text,
  p_months integer,
  p_stripe_event_id text,
  p_stripe_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_purchase_id uuid;
  v_base timestamptz;
  v_expires timestamptz;
  v_plan text;
  v_revive boolean;
begin
  if p_product not in ('event', 'extension') or p_months is null or p_months < 1
     or p_session_id is null or p_amount_cents is null or p_amount_cents < 0
     or p_currency !~ '^[a-z]{3}$'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  -- One session is applied by one transaction at a time: the webhook, its retries and the return
  -- page can arrive together, and the ones that come second must see the first one's purchase.
  perform pg_advisory_xact_lock(hashtextextended(p_session_id, 0));

  if p_stripe_event_id is not null then
    insert into public.stripe_events (stripe_event_id, type)
    values (p_stripe_event_id, coalesce(p_stripe_event_type, 'unknown'))
    on conflict (stripe_event_id) do nothing;
    if not found then
      return jsonb_build_object('ok', true, 'result', 'duplicate_event');
    end if;
  end if;

  if exists (select 1 from public.purchases where stripe_checkout_session_id = p_session_id) then
    return jsonb_build_object('ok', true, 'result', 'already_applied');
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
    values (null, 'purchase_orphan', 'event', p_event_id,
            jsonb_build_object('session', p_session_id, 'payment_intent', p_payment_intent,
                               'amount_cents', p_amount_cents, 'product', p_product));
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;

  insert into public.purchases (
    event_id, event_title, user_id, source, stripe_checkout_session_id, stripe_payment_intent_id,
    amount_cents, currency, product
  ) values (
    p_event_id, v_event.title, p_user_id, 'stripe', p_session_id, p_payment_intent,
    p_amount_cents, p_currency, p_product
  ) returning id into v_purchase_id;

  v_plan := v_event.plan;
  if p_product = 'event' then
    if v_plan = 'free' then
      v_plan := 'event';
    end if;
    v_base := greatest(now(), (v_event.event_date::timestamp at time zone 'utc'));
  else
    v_base := greatest(coalesce(v_event.expires_at, now()), now());
  end if;
  v_expires := v_base + make_interval(months => p_months);
  if v_event.expires_at is not null and v_event.expires_at > v_expires then
    v_expires := v_event.expires_at;
  end if;

  v_revive := v_event.status = 'pending_deletion' and v_event.deletion_reason = 'expired';
  update public.events
     set plan = v_plan,
         expires_at = v_expires,
         status = case when v_revive then 'active' else status end,
         deleted_at = case when v_revive then null else deleted_at end,
         deletion_reason = case when v_revive then null else deletion_reason end
   where id = p_event_id;

  return jsonb_build_object('ok', true, 'result', 'applied', 'purchase_id', v_purchase_id,
                            'plan', v_plan, 'expires_at', v_expires, 'revived', v_revive);
end;
$$;

revoke all on function public.claim_email(text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_email(text, uuid, text, integer) to service_role;
revoke all on function public.finish_email(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_email(text, uuid, text, text) to service_role;
revoke all on function public.release_email(text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_email(text, uuid, text) to service_role;
revoke all on function public.expire_due_events(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_due_events(timestamptz) to service_role;
revoke all on function public.purge_event(uuid) from public, anon, authenticated;
grant execute on function public.purge_event(uuid) to service_role;
