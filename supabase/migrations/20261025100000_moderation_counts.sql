-- Step 3.4 (fix of 3.3): how many media each guest has in the moderation lists.
--
-- PostgREST answers at most 1 000 rows per request, so counting guests' media from a plain select
-- is wrong past 1 000 media. Counting in the database is exact at any size.

-- Media of each guest of the event that are shown or hidden (the ones the organiser moderates).
-- Called by the server only, after it checked the caller owns the event.
create or replace function public.moderation_guest_counts(p_event_id uuid)
returns table (guest_id uuid, media_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.guest_id, count(*)
    from public.media m
   where m.event_id = p_event_id and m.status in ('ready', 'hidden')
   group by m.guest_id;
$$;

revoke all on function public.moderation_guest_counts(uuid) from public, anon, authenticated;
grant execute on function public.moderation_guest_counts(uuid) to service_role;
