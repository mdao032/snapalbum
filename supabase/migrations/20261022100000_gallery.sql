-- Step 3.1: gallery (F-039, F-050 to F-054, F-056) and share links (F-054).
--
-- Who writes what:
--  * The gallery is read by the server (service role) after it checked who asks: a guest of the
--    event with the gallery open, the organiser, or the holder of a share link. The RLS policy
--    `media_select_gallery` of step 2.2 stays as the rule for direct reads.
--  * `share_links` are created and revoked by the server only, after checking the organiser owns the
--    event. Organisers can read the links of their own events; guests never can.

-- ---------------------------------------------------------------------------------------------
-- media: the date a photo is sorted by
-- ---------------------------------------------------------------------------------------------

-- The day a photo was taken, or the day it was sent when the device did not tell (F-052). A
-- generated column because PostgREST cannot sort by an expression and the keyset pagination of the
-- gallery needs one sortable value.
alter table public.media
  add column captured_at timestamptz generated always as (coalesce(taken_at, created_at)) stored;

-- Keyset pagination of the gallery in both directions (the index is read backwards for "oldest
-- first"). Only what the gallery shows is indexed: approved media that are ready.
create index media_gallery_captured_idx
  on public.media (event_id, captured_at, id)
  where status = 'ready' and moderation = 'approved';

create index media_gallery_sent_idx
  on public.media (event_id, created_at, id)
  where status = 'ready' and moderation = 'approved';

-- ---------------------------------------------------------------------------------------------
-- share_links
-- ---------------------------------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- 24 random bytes, base64url (32 characters): a secret as long as an access token.
  token text not null unique check (char_length(token) >= 32),
  created_by uuid references auth.users (id) on delete set null,
  -- Set when the organiser revokes the link: it stops working at once, the row stays as a record.
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index share_links_event_id_idx on public.share_links (event_id);

alter table public.share_links enable row level security;

revoke all on public.share_links from anon;
revoke all on public.share_links from authenticated;
grant select on public.share_links to authenticated;

create policy "share_links_select_organiser"
  on public.share_links for select to authenticated
  using (event_id in (select id from public.events where owner_id = (select auth.uid())));

create policy "share_links_select_admin"
  on public.share_links for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- gallery_guests: who sent what, for the "sent by" filter (F-052)
-- ---------------------------------------------------------------------------------------------

-- Guests with at least one media the gallery shows, with how many. Called by the server only: the
-- names of guests are never given to the holder of a share link.
create or replace function public.gallery_guests(p_event_id uuid)
returns table (guest_id uuid, display_name text, media_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.display_name, count(*)
    from public.media m
    join public.guests g on g.id = m.guest_id
   where m.event_id = p_event_id and m.status = 'ready' and m.moderation = 'approved'
   group by g.id, g.display_name
   order by count(*) desc, g.display_name nulls last, g.id;
$$;

revoke all on function public.gallery_guests(uuid) from public, anon, authenticated;
grant execute on function public.gallery_guests(uuid) to service_role;
