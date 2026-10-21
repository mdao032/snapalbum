-- Step 2.2: guests, media, uploads and the atomic reservation of an upload slot (SPEC 7, 8, 7.1).
--
-- Who writes what:
--  * Guests and media are CREATED by the server only (service role): a guest row after the
--    anonymous sign-in (step 2.3), a media row through `reserve_media_slot`. Plans and quotas live
--    in `plans.ts`, so the server passes them to the function; they are never copied here.
--  * Organisers read the guests and media of their own events; guests read their own media, and
--    the gallery of their event when the organiser allows it.
--  * `uploads` (multipart bookkeeping) has no policy at all: only the server touches it.

-- ---------------------------------------------------------------------------------------------
-- guests
-- ---------------------------------------------------------------------------------------------
create table public.guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- The anonymous Supabase user (F-035). Deleting the user removes the guest and its media.
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 60),
  terms_accepted_at timestamptz,
  terms_version text,
  -- Set by the organiser through the server: the guest's future uploads are refused (F-072).
  blocked_at timestamptz,
  notify_email text check (notify_email is null or char_length(notify_email) <= 254),
  notify_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, auth_user_id)
);

create index guests_auth_user_id_idx on public.guests (auth_user_id);

create trigger guests_set_updated_at
  before update on public.guests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- media
-- ---------------------------------------------------------------------------------------------
create table public.media (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  guest_id uuid not null references public.guests (id) on delete cascade,
  kind text not null check (kind in ('photo', 'video')),
  -- pending: slot reserved, files not confirmed yet. ready: files checked and stored.
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'ready', 'hidden', 'rejected', 'deleted')),
  -- approved: visible in the gallery. pending: waits for the organiser (F-071).
  moderation text not null default 'approved' check (moderation in ('approved', 'pending', 'rejected')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type ~ '^(image|video)/[a-z0-9.+-]{1,60}$'),
  -- Declared sizes, checked against the storage when the upload is confirmed.
  bytes_original bigint check (bytes_original is null or bytes_original > 0),
  bytes_display bigint check (bytes_display is null or bytes_display > 0),
  bytes_thumb bigint check (bytes_thumb is null or bytes_thumb > 0),
  width integer check (width is null or width between 1 and 20000),
  height integer check (height is null or height between 1 and 20000),
  duration_s numeric check (duration_s is null or duration_s between 0 and 86400),
  taken_at timestamptz,
  key_original text,
  key_display text,
  key_thumb text,
  blurhash text check (blurhash is null or char_length(blurhash) <= 100),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A file is stored once per event: sending it twice is not an error (NF-012).
  unique (event_id, sha256),
  -- Every key lives under the event's own folder (SPEC 9.1).
  check (key_original is null or key_original like 'events/' || event_id || '/%'),
  check (key_display is null or key_display like 'events/' || event_id || '/%'),
  check (key_thumb is null or key_thumb like 'events/' || event_id || '/%')
);

create index media_event_status_idx on public.media (event_id, status);
create index media_guest_id_idx on public.media (guest_id);

create trigger media_set_updated_at
  before update on public.media
  for each row execute function public.set_updated_at();

-- Keeps `events.media_count` and `events.bytes_used` exact, whatever changes a media row. A media
-- counts (and its bytes with it) unless it was deleted or rejected, so reserving a slot already
-- holds the quota: simultaneous uploads cannot overshoot it.
create or replace function public.media_adjust_event_counters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_counted boolean := false;
  new_counted boolean := false;
  old_bytes bigint := 0;
  new_bytes bigint := 0;
  target_event uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_counted := old.status not in ('deleted', 'rejected');
    if old_counted then
      old_bytes := coalesce(old.bytes_original, 0) + coalesce(old.bytes_display, 0) + coalesce(old.bytes_thumb, 0);
    end if;
    target_event := old.event_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_counted := new.status not in ('deleted', 'rejected');
    if new_counted then
      new_bytes := coalesce(new.bytes_original, 0) + coalesce(new.bytes_display, 0) + coalesce(new.bytes_thumb, 0);
    end if;
    target_event := new.event_id;
  end if;

  if new_counted::int - old_counted::int <> 0 or new_bytes - old_bytes <> 0 then
    update public.events
       set media_count = media_count + (new_counted::int - old_counted::int),
           bytes_used = bytes_used + (new_bytes - old_bytes)
     where id = target_event;
  end if;
  return null;
end;
$$;

revoke all on function public.media_adjust_event_counters() from public, anon, authenticated;

create trigger media_adjust_counters
  after insert or update or delete on public.media
  for each row execute function public.media_adjust_event_counters();

-- ---------------------------------------------------------------------------------------------
-- uploads (multipart bookkeeping, server only)
-- ---------------------------------------------------------------------------------------------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null unique references public.media (id) on delete cascade,
  multipart_upload_id text not null,
  parts_done jsonb not null default '[]'::jsonb check (jsonb_typeof(parts_done) = 'array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger uploads_set_updated_at
  before update on public.uploads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.guests enable row level security;
alter table public.media enable row level security;
alter table public.uploads enable row level security;

revoke all on public.guests from anon, authenticated;
revoke all on public.media from anon, authenticated;
revoke all on public.uploads from anon, authenticated;

grant select on public.guests to authenticated;
-- A guest edits only their name; consent, blocking and terms are written by the server.
grant update (display_name) on public.guests to authenticated;
grant select on public.media to authenticated;

-- True when the current user is a guest of the event (used by the gallery policy).
create or replace function public.is_guest_of(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guests
    where event_id = p_event_id and auth_user_id = (select auth.uid()) and blocked_at is null
  );
$$;

revoke all on function public.is_guest_of(uuid) from public, anon;
grant execute on function public.is_guest_of(uuid) to authenticated;

-- Whether guests may browse the gallery of an event. A function because guests cannot read the
-- `events` table themselves. The setting is compared as text so a malformed `settings` can only
-- close the gallery, never fail the query.
create or replace function public.event_gallery_is_open(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.status = 'active' and e.settings ->> 'gallery_visible' = 'true'
  );
$$;

revoke all on function public.event_gallery_is_open(uuid) from public, anon;
grant execute on function public.event_gallery_is_open(uuid) to authenticated;

-- guests
create policy "guests_select_own"
  on public.guests for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy "guests_select_organiser"
  on public.guests for select to authenticated
  using (event_id in (select id from public.events where owner_id = (select auth.uid())));

create policy "guests_select_admin"
  on public.guests for select to authenticated
  using ((select public.is_admin()));

create policy "guests_update_own_name"
  on public.guests for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- media
create policy "media_select_own"
  on public.media for select to authenticated
  using (guest_id in (select id from public.guests where auth_user_id = (select auth.uid())));

create policy "media_select_organiser"
  on public.media for select to authenticated
  using (event_id in (select id from public.events where owner_id = (select auth.uid())));

create policy "media_select_admin"
  on public.media for select to authenticated
  using ((select public.is_admin()));

-- The gallery: approved, ready media of an active event whose organiser opened the gallery.
create policy "media_select_gallery"
  on public.media for select to authenticated
  using (
    status = 'ready'
    and moderation = 'approved'
    and (select public.is_guest_of(event_id))
    and (select public.event_gallery_is_open(event_id))
  );

-- uploads: no policy and no grant. Only the service role reaches this table.

-- ---------------------------------------------------------------------------------------------
-- reserve_media_slot
-- ---------------------------------------------------------------------------------------------

-- The upload window of an event, read defensively: organisers may write `settings` directly, so
-- anything that is not two valid instants in the right order means "closed" (null), never a failure.
create or replace function public.event_upload_window(p_settings jsonb)
returns table (opens_at timestamptz, closes_at timestamptz)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_opens timestamptz;
  v_closes timestamptz;
begin
  begin
    v_opens := (p_settings ->> 'upload_opens_at')::timestamptz;
    v_closes := (p_settings ->> 'upload_closes_at')::timestamptz;
  exception when others then
    return;
  end;
  if v_opens is null or v_closes is null or v_opens >= v_closes then
    return;
  end if;
  return query select v_opens, v_closes;
end;
$$;

revoke all on function public.event_upload_window(jsonb) from public, anon, authenticated;

-- Reserves one upload slot, atomically (SPEC 7.1, rule R1). Called by the server only, with the
-- limits of the event's plan read from `plans.ts` and the id of the guest's verified session.
--
-- The event row is locked first, so two simultaneous reservations on the same event are served
-- one after the other: the quota can never be exceeded. Refusals are returned, not raised:
--   { "ok": false, "reason": "..." }
-- Successes:
--   { "ok": true, "result": "reserved" | "resumed" | "duplicate", "media_id": "...", "moderation": "..." }
create or replace function public.reserve_media_slot(
  p_event_id uuid,
  p_user_id uuid,
  p_media_id uuid,
  p_sha256 text,
  p_kind text,
  p_mime_type text,
  p_bytes_original bigint,
  p_bytes_display bigint,
  p_bytes_thumb bigint,
  p_width integer,
  p_height integer,
  p_duration_s numeric,
  p_taken_at timestamptz,
  p_key_original text,
  p_key_display text,
  p_key_thumb text,
  p_max_media integer,
  p_max_videos integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_guest public.guests;
  v_existing public.media;
  v_opens timestamptz;
  v_closes timestamptz;
  v_prefix text := 'events/' || p_event_id || '/';
  v_moderation text;
  v_videos integer;
  v_count integer;
begin
  -- Shape of the request: the server validated it, this is the last line of defence.
  if p_kind not in ('photo', 'video')
     or p_sha256 !~ '^[0-9a-f]{64}$'
     or p_mime_type !~ '^(image|video)/[a-z0-9.+-]{1,60}$'
     or p_bytes_thumb is null or p_bytes_thumb <= 0
     or coalesce(p_bytes_original, 1) <= 0 or coalesce(p_bytes_display, 1) <= 0
     or greatest(coalesce(p_bytes_original, 0), coalesce(p_bytes_display, 0), p_bytes_thumb) > 5368709120
     or (p_kind = 'photo' and (p_bytes_display is null))
     or (p_kind = 'video' and (p_bytes_original is null or p_bytes_display is not null))
     or (p_width is not null and p_width not between 1 and 20000)
     or (p_height is not null and p_height not between 1 and 20000)
     or (p_duration_s is not null and p_duration_s not between 0 and 86400)
     or p_max_media is null or p_max_media < 0
     or (p_key_thumb is null or left(p_key_thumb, length(v_prefix)) <> v_prefix)
     or (p_key_original is not null and left(p_key_original, length(v_prefix)) <> v_prefix)
     or (p_key_display is not null and left(p_key_display, length(v_prefix)) <> v_prefix)
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'event_not_found');
  end if;
  if v_event.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'event_suspended');
  end if;
  if v_event.expires_at is not null and v_event.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'upload_window_closed');
  end if;

  select * into v_guest from public.guests
   where event_id = p_event_id and auth_user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_a_guest');
  end if;
  if v_guest.blocked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'guest_blocked');
  end if;
  if v_guest.terms_accepted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'terms_required');
  end if;

  select w.opens_at, w.closes_at into v_opens, v_closes from public.event_upload_window(v_event.settings) w;
  if v_opens is null or now() < v_opens or now() >= v_closes then
    return jsonb_build_object('ok', false, 'reason', 'upload_window_closed');
  end if;

  v_moderation := case when coalesce(v_event.settings ->> 'require_approval', 'false') = 'true'
                       then 'pending' else 'approved' end;

  -- Reservations never confirmed free their slot after three hours (lost phone, closed tab).
  delete from public.media
   where event_id = p_event_id and status = 'pending' and created_at < now() - interval '3 hours';

  -- The same file again (NF-012): already stored, or this guest's own unfinished reservation.
  select * into v_existing from public.media
   where event_id = p_event_id and sha256 = p_sha256 and status not in ('deleted', 'rejected');
  if found then
    if v_existing.status = 'pending' and v_existing.guest_id = v_guest.id then
      update public.media
         set bytes_original = p_bytes_original, bytes_display = p_bytes_display,
             bytes_thumb = p_bytes_thumb, width = p_width, height = p_height,
             duration_s = p_duration_s
       where id = v_existing.id;
      return jsonb_build_object('ok', true, 'result', 'resumed', 'media_id', v_existing.id,
                                'moderation', v_existing.moderation);
    end if;
    return jsonb_build_object('ok', true, 'result', 'duplicate', 'media_id', v_existing.id,
                              'moderation', v_existing.moderation);
  end if;

  -- A rejected or deleted copy of the same file may be sent again: free its unique slot.
  delete from public.media
   where event_id = p_event_id and sha256 = p_sha256 and status in ('deleted', 'rejected');

  -- Quota (R1). Read again: the clean-ups above refreshed the counter through the triggers, and
  -- the event row is locked, so nobody else can change it until this function returns.
  select media_count into v_count from public.events where id = p_event_id;
  if v_count >= p_max_media then
    return jsonb_build_object('ok', false, 'reason', 'album_full');
  end if;
  if p_kind = 'video' and p_max_videos is not null then
    select count(*) into v_videos from public.media
     where event_id = p_event_id and kind = 'video' and status not in ('deleted', 'rejected');
    if v_videos >= p_max_videos then
      return jsonb_build_object('ok', false, 'reason', 'video_limit_reached');
    end if;
  end if;

  insert into public.media (
    id, event_id, guest_id, kind, status, moderation, sha256, mime_type,
    bytes_original, bytes_display, bytes_thumb, width, height, duration_s, taken_at,
    key_original, key_display, key_thumb
  ) values (
    p_media_id, p_event_id, v_guest.id, p_kind, 'pending', v_moderation, p_sha256, p_mime_type,
    p_bytes_original, p_bytes_display, p_bytes_thumb, p_width, p_height, p_duration_s, p_taken_at,
    p_key_original, p_key_display, p_key_thumb
  );

  return jsonb_build_object('ok', true, 'result', 'reserved', 'media_id', p_media_id,
                            'moderation', v_moderation);
end;
$$;

revoke all on function public.reserve_media_slot(
  uuid, uuid, uuid, text, text, text, bigint, bigint, bigint, integer, integer, numeric,
  timestamptz, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_media_slot(
  uuid, uuid, uuid, text, text, text, bigint, bigint, bigint, integer, integer, numeric,
  timestamptz, text, text, text, integer, integer
) to service_role;
