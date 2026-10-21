-- Step 3.1 bis: the organiser declares the album ready (F-044).
--
-- Guests who left an e-mail address (`guests.notify_email`, with `notify_consent_at`) get the link
-- of the album when this happens, or at J+1 by default; the mailer is wired in step 4.3. The moment
-- is kept in `events.settings.album_ready_at`, once.

-- Marks the album ready, once, and says whether it already was. Called by the server only, with the
-- id of the authenticated organiser. The event row is locked, so two simultaneous calls (a double
-- click, two tabs) agree on one moment and the guests cannot be told twice.
--   { "ok": false }                                               not the organiser's active event
--   { "ok": true, "ready_at": "...", "already": true | false }
create or replace function public.mark_album_ready(p_event_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_ready text;
begin
  select * into v_event
    from public.events
   where id = p_event_id and owner_id = p_owner_id and status = 'active'
     for update;
  if not found then
    return jsonb_build_object('ok', false);
  end if;

  if jsonb_typeof(v_event.settings -> 'album_ready_at') = 'string' then
    return jsonb_build_object('ok', true, 'ready_at', v_event.settings ->> 'album_ready_at', 'already', true);
  end if;

  v_ready := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  update public.events
     set settings = settings || jsonb_build_object('album_ready_at', v_ready)
   where id = p_event_id;
  return jsonb_build_object('ok', true, 'ready_at', v_ready, 'already', false);
end;
$$;

revoke all on function public.mark_album_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_album_ready(uuid, uuid) to service_role;
