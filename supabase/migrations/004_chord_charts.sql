-- ═══════════════════════════════════════════════════════════════════
--  Update 4: chord charts. Each song can store its chord chart (pasted or
--  uploaded from SongSelect) and the key it's written in. The app changes
--  it to any key. Same security rules as songs: team views, leaders edit.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
alter table public.songs add column if not exists chart text not null default '';
alter table public.songs add column if not exists chart_key text not null default '';
alter table public.songs add column if not exists has_chart boolean generated always as (length(chart) > 0) stored;
