-- Step 4.2: purchases and the Stripe webhook journal (SPEC 7, 13).
--
-- Who writes what:
--  * `purchases` and `stripe_events` are written by the server only (service role), from the
--    webhook or from the return of the payment page. Organisers READ their own purchases.
--  * The two functions below apply a payment or a refund to the event in ONE transaction: the
--    purchase, the new plan, the new expiry and the webhook journal agree or none of them happens,
--    so a webhook replayed twice, or a webhook racing the return page, has one effect.
--  * Purchases are accounting records: they outlive the event (`on delete set null`, with the
--    title kept next to them) and are never deleted by the purge of an event.

-- ---------------------------------------------------------------------------------------------
-- purchases (SPEC 7: one rights model whatever the source)
-- ---------------------------------------------------------------------------------------------
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete set null,
  -- Kept for the history once the event is gone.
  event_title text not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  source text not null default 'stripe' check (source in ('stripe', 'app_store', 'google_play')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  store_transaction_id text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  product text not null check (product in ('event', 'extension')),
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index purchases_payment_intent_idx
  on public.purchases (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index purchases_user_idx on public.purchases (user_id, created_at desc);
create index purchases_event_idx on public.purchases (event_id) where event_id is not null;

create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

alter table public.purchases enable row level security;
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;

create policy "purchases_select_own"
  on public.purchases for select to authenticated
  using (user_id = (select auth.uid()));

create policy "purchases_select_admin"
  on public.purchases for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- stripe_events: the webhook journal, for idempotence
-- ---------------------------------------------------------------------------------------------
create table public.stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  type text not null,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger stripe_events_set_updated_at
  before update on public.stripe_events
  for each row execute function public.set_updated_at();

-- No policy and no grant: only the service role reaches this table.
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- apply_purchase: a paid checkout session becomes a plan and an expiry
-- ---------------------------------------------------------------------------------------------
-- `p_months` comes from `plans.ts` (retention of the event plan, or length of an extension). The
-- retention of the event plan runs from the later of the purchase and the event date, so an album
-- bought months ahead is still kept after the party; an extension runs from the current expiry.
-- A longer existing expiry is never shortened.
--   { "ok": false, "reason": "event_not_found" }      the payment is kept for a manual refund
--   { "ok": true, "result": "duplicate_event" }       this webhook event was already handled
--   { "ok": true, "result": "already_applied" }       this session was already applied
--   { "ok": true, "result": "applied", "purchase_id": "...", "plan": "...", "expires_at": "..." }
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
begin
  if p_product not in ('event', 'extension') or p_months is null or p_months < 1
     or p_session_id is null or p_amount_cents is null or p_amount_cents < 0
     or p_currency !~ '^[a-z]{3}$'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

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

  update public.events set plan = v_plan, expires_at = v_expires where id = p_event_id;

  return jsonb_build_object('ok', true, 'result', 'applied', 'purchase_id', v_purchase_id,
                            'plan', v_plan, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- apply_refund: a fully refunded payment takes its effect back
-- ---------------------------------------------------------------------------------------------
-- Refunding the event plan puts the event back on the free plan with the free retention
-- (`p_free_expires_at`, computed from `plans.ts`); photos already sent are never deleted for
-- quota (R1), new uploads simply follow the free limits again. Refunding an extension takes its
-- months back. Every refund leaves an entry in the audit log.
--   { "ok": true, "result": "duplicate_event" | "unknown_purchase" | "already_refunded" }
--   { "ok": true, "result": "refunded", "purchase_id": "...", "event_id": "..." | null }
create or replace function public.apply_refund(
  p_payment_intent text,
  p_months integer,
  p_free_expires_at timestamptz,
  p_stripe_event_id text,
  p_stripe_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_event public.events;
begin
  if p_payment_intent is null or p_months is null or p_months < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  if p_stripe_event_id is not null then
    insert into public.stripe_events (stripe_event_id, type)
    values (p_stripe_event_id, coalesce(p_stripe_event_type, 'unknown'))
    on conflict (stripe_event_id) do nothing;
    if not found then
      return jsonb_build_object('ok', true, 'result', 'duplicate_event');
    end if;
  end if;

  select * into v_purchase from public.purchases
   where stripe_payment_intent_id = p_payment_intent for update;
  if not found then
    return jsonb_build_object('ok', true, 'result', 'unknown_purchase');
  end if;
  if v_purchase.status = 'refunded' then
    return jsonb_build_object('ok', true, 'result', 'already_refunded');
  end if;

  update public.purchases set status = 'refunded', refunded_at = now() where id = v_purchase.id;

  if v_purchase.event_id is not null then
    select * into v_event from public.events where id = v_purchase.event_id for update;
    if found then
      if v_purchase.product = 'event' then
        update public.events set plan = 'free', expires_at = p_free_expires_at
         where id = v_event.id and plan = 'event';
      elsif v_event.expires_at is not null then
        update public.events
           set expires_at = v_event.expires_at - make_interval(months => p_months)
         where id = v_event.id;
      end if;
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (null, 'purchase_refunded', 'event', v_purchase.event_id,
          jsonb_build_object('purchase_id', v_purchase.id, 'product', v_purchase.product,
                             'amount_cents', v_purchase.amount_cents));

  return jsonb_build_object('ok', true, 'result', 'refunded', 'purchase_id', v_purchase.id,
                            'event_id', v_purchase.event_id);
end;
$$;

revoke all on function public.apply_purchase(
  uuid, uuid, text, text, integer, text, text, integer, text, text
) from public, anon, authenticated;
grant execute on function public.apply_purchase(
  uuid, uuid, text, text, integer, text, text, integer, text, text
) to service_role;

revoke all on function public.apply_refund(text, integer, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_refund(text, integer, timestamptz, text, text)
  to service_role;
