-- Step 6.2: feedback from organisers and guests during the field beta. Written by the server with
-- the service role after it checked who the author is (an organiser of the event, or a guest of
-- it); read and marked as handled by the administrators. Closed to the API like the other
-- server-only tables.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete set null,
  audience text not null check (audience in ('organiser', 'guest')),
  -- The feedback goes away with the account that wrote it (an anonymous guest included).
  user_id uuid references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 1000),
  locale text not null check (locale in ('fr', 'en')),
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_open_idx on public.feedback (created_at) where handled_at is null;

alter table public.feedback enable row level security;
-- No policy: only the service role reads and writes.
revoke all on public.feedback from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- admin_list_feedback
-- ---------------------------------------------------------------------------------------------
-- Newest first, with the event's title and the author's address for organisers (guests have none).
-- `average` is over every rating ever given; `open` counts those not yet handled.
create or replace function public.admin_list_feedback(p_limit integer, p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_open bigint;
  v_average numeric;
  v_rows jsonb;
begin
  select count(*), count(*) filter (where handled_at is null), avg(rating)
    into v_total, v_open, v_average
    from public.feedback;

  select coalesce(jsonb_agg(row_to_json(page)), '[]'::jsonb) into v_rows
    from (
      select f.id, f.audience, f.rating, f.message, f.locale, f.created_at, f.handled_at,
             f.event_id, e.title as event_title,
             case when f.audience = 'organiser' then u.email end as author_email
        from public.feedback f
        left join public.events e on e.id = f.event_id
        left join auth.users u on u.id = f.user_id
       order by (f.handled_at is not null), f.created_at desc, f.id
       limit greatest(p_limit, 1) offset greatest(p_offset, 0)
    ) page;

  return jsonb_build_object('total', v_total, 'open', v_open,
                            'average', round(coalesce(v_average, 0), 1), 'rows', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- admin_set_feedback_handled
-- ---------------------------------------------------------------------------------------------
--   { "ok": false } when the feedback does not exist
create or replace function public.admin_set_feedback_handled(
  p_actor uuid,
  p_id uuid,
  p_handled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.feedback
     set handled_at = case when p_handled then coalesce(handled_at, now()) else null end
   where id = p_id;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.audit_log (actor_id, action, target_type, target_id, metadata)
  values (p_actor, case when p_handled then 'admin.feedback.handle' else 'admin.feedback.reopen' end,
          'feedback', p_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_list_feedback(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_feedback(integer, integer) to service_role;
revoke all on function public.admin_set_feedback_handled(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_feedback_handled(uuid, uuid, boolean) to service_role;
