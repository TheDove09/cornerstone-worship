-- ═══════════════════════════════════════════════════════════════════
--  Update 3: live updates. The database tells open apps the moment
--  messages, set lists, songs or team info change. The security rules still
--  decide who hears about what. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['messages','services','service_songs','songs','profiles'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
