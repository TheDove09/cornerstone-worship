-- ═══════════════════════════════════════════════════════════════════
--  Update 5: "Delete just for me". Remembers which messages each person has
--  removed from their own list. Nobody can see anyone else's list.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.hidden_messages (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id  uuid not null references public.messages(id) on delete cascade,
  hidden_at   timestamptz not null default now(),
  primary key (user_id, message_id)
);

alter table public.hidden_messages enable row level security;
grant select, insert, delete on public.hidden_messages to authenticated;

drop policy if exists "my hidden messages" on public.hidden_messages;
create policy "my hidden messages" on public.hidden_messages for select using (user_id = auth.uid());
drop policy if exists "hide a message for me" on public.hidden_messages;
create policy "hide a message for me" on public.hidden_messages for insert with check (user_id = auth.uid() and public.is_member());
drop policy if exists "unhide a message" on public.hidden_messages;
create policy "unhide a message" on public.hidden_messages for delete using (user_id = auth.uid());
