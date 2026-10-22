-- Step 5.2c: deletion of an organiser's account (F-004, G-004, R5).
--
-- Who writes what: everything here is done by the server with the service role (the account page's
-- actions and the daily task). Nothing is granted to organisers or guests; `profiles.deleted_at`
-- was already out of their reach (they can only edit their name and language).
--
-- The flow, in short:
--   1. The organiser asks: `request_account_deletion` marks the account and closes every active
--      event (they leave the guests' sight, reason 'account'). 7 days to change their mind.
--   2. They can cancel during those 7 days: `cancel_account_deletion` brings it all back.
--   3. After 7 days the daily task empties the storage, calls `prepare_account_purge`, purges each
--      event with `purge_event`, calls `finish_account_purge`, then deletes the sign-in account.

-- ---------------------------------------------------------------------------------------------
-- Purchases outlive the account: accounting records (SPEC 7, 13)
-- ---------------------------------------------------------------------------------------------
-- The link to the person is cut (`user_id` becomes null) when the account is deleted; the amount,
-- the date and the Stripe identifiers stay for the accounting obligations.
alter table public.purchases alter column user_id drop not null;
alter table public.purchases drop constraint purchases_user_id_fkey;
alter table public.purchases
  add constraint purchases_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- events.deletion_reason: a third reason
-- ---------------------------------------------------------------------------------------------
-- 'account': closed because its organiser asked to delete their account. It comes back only if
-- they cancel the deletion of the account (not one event at a time).
alter table public.events drop constraint events_deletion_reason_check;
alter table public.events
  add constraint events_deletion_reason_check
  check (deletion_reason in ('user', 'expired', 'account'));

-- ---------------------------------------------------------------------------------------------
-- request_account_deletion
-- ---------------------------------------------------------------------------------------------
-- In ONE transaction: the account is marked, its active events start their 7 days (a suspended
-- event stays suspended: it is purged with the rest), the audit line is written. Asking twice is
-- refused, so the 7 days cannot be pushed back by asking again.
--   { "ok": false, "reason": "no_profile" | "already_requested", "deleted_at"?: ... }
--   { "ok": true, "deleted_at": "...", "event_ids": ["<id>", ...] }
create or replace function public.request_account_deletion(p_user_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_ids uuid[];
begin
  select * into v_profile from public.profiles where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;
  if v_profile.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_requested',
                              'deleted_at', v_profile.deleted_at);
  end if;

  update public.profiles set deleted_at = p_now where user_id = p_user_id;

  with closed as (
    update public.events
       set status = 'pending_deletion', deleted_at = p_now, deletion_reason = 'account'
     where owner_id = p_user_id and status = 'active'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from closed;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_user_id, 'account_deletion_requested', 'user', p_user_id,
          jsonb_build_object('events', cardinality(v_ids)));

  return jsonb_build_object('ok', true, 'deleted_at', p_now, 'event_ids', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- cancel_account_deletion
-- ---------------------------------------------------------------------------------------------
-- Within the grace period only. The events closed by the request come back as they were (active);
-- an event the organiser deleted on purpose before, or that expired, stays as it is.
--   { "ok": false, "reason": "not_requested" | "too_late" }
--   { "ok": true, "restored": n }
create or replace function public.cancel_account_deletion(
  p_user_id uuid,
  p_now timestamptz,
  p_grace_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_restored integer;
begin
  select * into v_profile from public.profiles where user_id = p_user_id for update;
  if not found or v_profile.deleted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_requested');
  end if;
  if p_now >= v_profile.deleted_at + make_interval(days => p_grace_days) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  update public.profiles set deleted_at = null where user_id = p_user_id;

  with restored as (
    update public.events
       set status = 'active', deleted_at = null, deletion_reason = null
     where owner_id = p_user_id and status = 'pending_deletion' and deletion_reason = 'account'
    returning id
  )
  select count(*) into v_restored from restored;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_user_id, 'account_deletion_cancelled', 'user', p_user_id,
          jsonb_build_object('events', v_restored));

  return jsonb_build_object('ok', true, 'restored', v_restored);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- prepare_account_purge: every event of the account is ready to be purged
-- ---------------------------------------------------------------------------------------------
-- Only for an account whose deletion was requested (never for an active one). Every event it still
-- owns, whatever its state, is put to wait for deletion so that `purge_event` accepts it; the
-- server empties each one's files first, then purges it.
--   { "ok": false }
--   { "ok": true, "event_ids": ["<id>", ...] }
create or replace function public.prepare_account_purge(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_ids uuid[];
begin
  select * into v_profile from public.profiles where user_id = p_user_id for update;
  if not found or v_profile.deleted_at is null then
    return jsonb_build_object('ok', false);
  end if;

  update public.events
     set status = 'pending_deletion',
         deleted_at = coalesce(deleted_at, now()),
         deletion_reason = coalesce(deletion_reason, 'account')
   where owner_id = p_user_id and status <> 'pending_deletion';

  select coalesce(array_agg(id), '{}') into v_ids from public.events where owner_id = p_user_id;
  return jsonb_build_object('ok', true, 'event_ids', to_jsonb(v_ids));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- finish_account_purge: the last step before the sign-in account is deleted
-- ---------------------------------------------------------------------------------------------
-- Refused while an event remains (the sign-in account cannot be deleted before them). The titles of
-- the purchases are erased (a title can name people); the amounts, dates and Stripe identifiers
-- stay. The audit line holds no name and no e-mail address.
--   { "ok": false, "reason": "not_requested" | "events_remain" }
--   { "ok": true, "purchases": n }
create or replace function public.finish_account_purge(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_purchases integer;
begin
  select * into v_profile from public.profiles where user_id = p_user_id for update;
  if not found or v_profile.deleted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_requested');
  end if;
  if exists (select 1 from public.events where owner_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'events_remain');
  end if;

  with erased as (
    update public.purchases set event_title = '' where user_id = p_user_id returning 1
  )
  select count(*) into v_purchases from erased;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (null, 'account_purged', 'user', p_user_id, jsonb_build_object('purchases', v_purchases));

  return jsonb_build_object('ok', true, 'purchases', v_purchases);
end;
$$;

revoke all on function public.request_account_deletion(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid, timestamptz) to service_role;
revoke all on function public.cancel_account_deletion(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.cancel_account_deletion(uuid, timestamptz, integer) to service_role;
revoke all on function public.prepare_account_purge(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_purge(uuid) to service_role;
revoke all on function public.finish_account_purge(uuid) from public, anon, authenticated;
grant execute on function public.finish_account_purge(uuid) to service_role;
