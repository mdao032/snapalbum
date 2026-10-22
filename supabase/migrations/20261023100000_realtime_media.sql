-- Step 3.2: live slideshow (F-061). The page listens to the media of its event through Supabase
-- Realtime. Realtime applies the table's RLS to every change it sends: a guest or an organiser
-- receives only the media they could read anyway (approved and ready for the gallery, everything
-- for the organiser), so nothing new is exposed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media'
  ) then
    alter publication supabase_realtime add table public.media;
  end if;
end;
$$;
