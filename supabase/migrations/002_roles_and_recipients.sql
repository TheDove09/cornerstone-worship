-- ═══════════════════════════════════════════════════════════════════
--  Update 2: team roles (Bass, Vocals, Pastor…) + choose who gets a message
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

-- Roles on the team (a person can have several). Only leaders can change them.
alter table public.profiles add column if not exists positions text[] not null default '{}';

-- Who a message is for. Empty (null) = everyone on the team.
alter table public.messages add column if not exists recipient_ids uuid[];

-- Members can't change their own app access, email or roles — only leaders can.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.email is distinct from old.email
          or new.id is distinct from old.id or new.positions is distinct from old.positions)
     and not public.is_admin()
     and coalesce(current_setting('app.joining', true), '') <> 'yes' then
    raise exception 'Only a leader can change that.';
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one leader.';
  end if;
  return new;
end $$;

-- Team members only see messages sent to everyone or to them.
-- Leaders see every message (so both leaders know what's been sent).
drop policy if exists "team can view" on public.messages;
drop policy if exists "see messages meant for me" on public.messages;
create policy "see messages meant for me" on public.messages for select using (
  public.is_member() and (
    recipient_ids is null
    or auth.uid() = any (recipient_ids)
    or author_id = auth.uid()
    or public.is_admin()
  )
);
