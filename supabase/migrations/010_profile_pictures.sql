-- ═══════════════════════════════════════════════════════════════════
--  Update 10: profile pictures.
--  Photos live in a PRIVATE storage folder: only signed-in team members can
--  see them, and each person can only add, change or remove their own.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists avatar_version bigint;   -- set when the photo changes (null = no photo)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists "team can see profile pictures" on storage.objects;
create policy "team can see profile pictures" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_member());

drop policy if exists "add my own profile picture" on storage.objects;
create policy "add my own profile picture" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' and public.is_member());

drop policy if exists "change my own profile picture" on storage.objects;
create policy "change my own profile picture" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' and public.is_member())
  with check (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg');

drop policy if exists "remove my own profile picture" on storage.objects;
create policy "remove my own profile picture" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name = auth.uid()::text || '.jpg' and public.is_member());
