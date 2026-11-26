-- ═══════════════════════════════════════════════════════════════════
--  Cornerstone Worship Team — database setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run once on a brand-new project.
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── People ─────────────────────────────────────────────────────────
-- role: 'pending' (made a profile but hasn't entered the church CCLI login yet)
--       'member'  (team member — can see everything)
--       'admin'   (leader — can add songs, plan services, send messages, manage team)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null default '',
  role        text not null default 'pending' check (role in ('pending','member','admin')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), coalesce(new.email, ''));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member','admin'), false)
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Nobody can promote themselves; there is always at least one leader.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null only for the Supabase dashboard / SQL editor (trusted)
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.email is distinct from old.email or new.id is distinct from old.id)
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

create trigger protect_profile
  before update on public.profiles for each row execute function public.protect_profile();

-- ── Church CCLI login (the "key" to join the team) ─────────────────
-- Only a scrambled (bcrypt) version of the password is stored.
-- No one can read this table directly — only the functions below use it.
create table public.team_secret (
  id             int primary key default 1 check (id = 1),
  ccli_email     text not null,
  password_hash  text not null,
  updated_at     timestamptz not null default now()
);

-- Slows down guessing: 5 wrong tries = locked out for 15 minutes.
create table public.join_attempts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  tried_at    timestamptz not null default now()
);

create or replace function public.set_team_secret(p_email text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_admin() then raise exception 'Only a leader can change that.'; end if;
  if coalesce(trim(p_email), '') = '' or length(coalesce(p_password, '')) < 4 then
    raise exception 'Please enter the church CCLI email and password.';
  end if;
  insert into public.team_secret (id, ccli_email, password_hash, updated_at)
  values (1, lower(trim(p_email)), crypt(p_password, gen_salt('bf', 10)), now())
  on conflict (id) do update
    set ccli_email = excluded.ccli_email, password_hash = excluded.password_hash, updated_at = now();
end $$;

create or replace function public.team_secret_status() returns table (ccli_email text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ccli_email, updated_at from public.team_secret where public.is_admin()
$$;

create or replace function public.join_team(p_email text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare s public.team_secret;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if public.is_member() then return true; end if;

  if (select count(*) from public.join_attempts
      where user_id = auth.uid() and tried_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many tries. Please wait 15 minutes, or ask a leader for help.';
  end if;

  select * into s from public.team_secret where id = 1;
  if s is null then
    raise exception 'A leader has not set up the church CCLI login in the app yet.';
  end if;

  if lower(trim(p_email)) = s.ccli_email and crypt(p_password, s.password_hash) = s.password_hash then
    perform set_config('app.joining', 'yes', true);
    update public.profiles set role = 'member' where id = auth.uid() and role = 'pending';
    perform set_config('app.joining', '', true);   -- switch the bypass off again immediately
    delete from public.join_attempts where user_id = auth.uid();
    return true;
  end if;

  insert into public.join_attempts (user_id) values (auth.uid());
  return false;
end $$;

revoke all on function public.set_team_secret(text, text) from public, anon;
revoke all on function public.join_team(text, text) from public, anon;
revoke all on function public.team_secret_status() from public, anon;
grant execute on function public.set_team_secret(text, text) to authenticated;
grant execute on function public.join_team(text, text) to authenticated;
grant execute on function public.team_secret_status() to authenticated;

-- ── Songs, services (set lists), messages ──────────────────────────
create table public.songs (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  artist          text not null default '',
  ccli_number     text not null default '',
  default_key     text not null default '',
  tempo           int,
  time_signature  text not null default '',
  songselect_url  text not null default '',
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

create table public.services (
  id            uuid primary key default gen_random_uuid(),
  service_date  date not null,
  title         text not null default 'Sunday Service',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

create table public.service_songs (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references public.services(id) on delete cascade,
  song_id     uuid not null references public.songs(id) on delete cascade,
  position    int  not null default 0,
  song_key    text not null default '',
  notes       text not null default ''
);
create index on public.service_songs (service_id);

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null default '',
  service_id   uuid references public.services(id) on delete set null,
  author_id    uuid references auth.users(id) on delete set null default auth.uid(),
  author_name  text not null default '',
  created_at   timestamptz not null default now()
);

-- Newer Supabase projects don't grant table access automatically.
-- Signed-in users get table access; the security rules below decide what they can actually see/do.
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.songs, public.services, public.service_songs, public.messages to authenticated;

-- ── Security rules (Row Level Security) ────────────────────────────
alter table public.profiles      enable row level security;
alter table public.team_secret   enable row level security;  -- no policies = no direct access
alter table public.join_attempts enable row level security;  -- no policies = no direct access
alter table public.songs         enable row level security;
alter table public.services      enable row level security;
alter table public.service_songs enable row level security;
alter table public.messages      enable row level security;

create policy "see own profile or team" on public.profiles for select
  using (id = auth.uid() or public.is_member());
create policy "edit own name, leaders edit anyone" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['songs','services','service_songs','messages'] loop
    execute format('create policy "team can view" on public.%I for select using (public.is_member())', t);
    execute format('create policy "leaders can add" on public.%I for insert with check (public.is_admin())', t);
    execute format('create policy "leaders can edit" on public.%I for update using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "leaders can delete" on public.%I for delete using (public.is_admin())', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════
--  AFTER you and the other leader have each made a profile in the app,
--  run this (with your real emails) to make you both leaders:
--
--  update public.profiles set role = 'admin'
--  where email in ('you@example.com', 'otherleader@example.com');
-- ═══════════════════════════════════════════════════════════════════


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


-- ═══════════════════════════════════════════════════════════════════
--  Update 4: chord charts. Each song can store its chord chart (pasted or
--  uploaded from SongSelect) and the key it's written in. The app changes
--  it to any key. Same security rules as songs: team views, leaders edit.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
alter table public.songs add column if not exists chart text not null default '';
alter table public.songs add column if not exists chart_key text not null default '';
alter table public.songs add column if not exists has_chart boolean generated always as (length(chart) > 0) stored;


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


-- ═══════════════════════════════════════════════════════════════════
--  Update 6: two-step sign-in.
--  After the password, each sign-in must be confirmed with a 6-digit code
--  emailed to the person, or with Face ID / Touch ID (a passkey).
--  The DATABASE enforces this: an unconfirmed sign-in sees nothing.
--  It starts switched OFF; a leader turns it on from the app after a
--  test code arrives, so nobody is locked out if email isn't set up yet.
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

-- On/off switch (one row).
create table if not exists public.app_settings (
  id           int primary key default 1 check (id = 1),
  require_2fa  boolean not null default false,
  updated_at   timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "signed-in people can read settings" on public.app_settings;
create policy "signed-in people can read settings" on public.app_settings for select using (auth.uid() is not null);
grant select on public.app_settings to authenticated;

-- Sign-ins that have been confirmed (one row per sign-in session).
-- Signing out removes the session, and this row with it.
create table if not exists public.verified_sessions (
  session_id   uuid primary key references auth.sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  method       text not null check (method in ('email', 'passkey')),
  verified_at  timestamptz not null default now()
);
alter table public.verified_sessions enable row level security;   -- only the server program writes here

-- The current emailed code for each person (stored scrambled, never in plain text).
create table if not exists public.login_codes (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  code_hash       text not null,
  expires_at      timestamptz not null,
  attempts        int not null default 0,
  sent_at         timestamptz not null default now(),
  hour_started    timestamptz not null default now(),
  sends_this_hour int not null default 1
);
alter table public.login_codes enable row level security;          -- only the server program reads/writes

-- Face ID / Touch ID keys. Only the public half is stored; the private half never leaves the phone.
create table if not exists public.passkeys (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  public_key    text not null,
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device_name   text not null default '',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists passkeys_user on public.passkeys (user_id);
alter table public.passkeys enable row level security;
grant select (id, user_id, device_name, created_at, last_used_at), delete on public.passkeys to authenticated;
drop policy if exists "see my passkeys" on public.passkeys;
create policy "see my passkeys" on public.passkeys for select using (user_id = auth.uid());

create table if not exists public.passkey_challenges (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  challenge   text not null,
  kind        text not null check (kind in ('register', 'login')),
  expires_at  timestamptz not null
);
alter table public.passkey_challenges enable row level security;   -- only the server program

-- Is THIS sign-in confirmed? (Always yes while the switch is off.)
create or replace function public.this_session_confirmed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.verified_sessions v
    where v.user_id = auth.uid()
      and v.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  )
$$;
create or replace function public.session_verified() returns boolean
language sql stable security definer set search_path = public as $$
  select not coalesce((select require_2fa from public.app_settings where id = 1), false)
      or public.this_session_confirmed()
$$;

-- Members and leaders only count as such once this sign-in is confirmed.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('member','admin'), false) and public.session_verified()
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false) and public.session_verified()
$$;

-- Joining the team also needs a confirmed sign-in.
create or replace function public.join_team(p_email text, p_password text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare s public.team_secret;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not public.session_verified() then raise exception 'Please finish confirming your sign-in first.'; end if;
  if public.is_member() then return true; end if;

  if (select count(*) from public.join_attempts
      where user_id = auth.uid() and tried_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many tries. Please wait 15 minutes, or ask a leader for help.';
  end if;

  select * into s from public.team_secret where id = 1;
  if s is null then
    raise exception 'A leader has not set up the church CCLI login in the app yet.';
  end if;

  if lower(trim(p_email)) = s.ccli_email and crypt(p_password, s.password_hash) = s.password_hash then
    perform set_config('app.joining', 'yes', true);
    update public.profiles set role = 'member' where id = auth.uid() and role = 'pending';
    perform set_config('app.joining', '', true);
    delete from public.join_attempts where user_id = auth.uid();
    return true;
  end if;

  insert into public.join_attempts (user_id) values (auth.uid());
  return false;
end $$;

-- What the app needs to know about this sign-in.
create or replace function public.my_security() returns table (required boolean, verified boolean, passkeys int)
language sql stable security definer set search_path = public as $$
  select coalesce((select require_2fa from public.app_settings where id = 1), false),
         public.this_session_confirmed(),
         (select count(*)::int from public.passkeys where user_id = auth.uid())
$$;

-- Leaders switch two-step sign-in on (only after confirming a code themselves) or off.
create or replace function public.set_require_2fa(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only a leader can change that.'; end if;
  if p_on and not public.this_session_confirmed() then
    raise exception 'Please confirm a code from your email first.';
  end if;
  update public.app_settings set require_2fa = p_on, updated_at = now() where id = 1;
end $$;

revoke all on function public.my_security() from public, anon;
revoke all on function public.set_require_2fa(boolean) from public, anon;
grant execute on function public.my_security() to authenticated;
grant execute on function public.set_require_2fa(boolean) to authenticated;

-- (needs session_verified, defined above)
drop policy if exists "remove my passkeys" on public.passkeys;
create policy "remove my passkeys" on public.passkeys for delete using (user_id = auth.uid() and public.session_verified());


-- ═══════════════════════════════════════════════════════════════════
--  Update 7: Face ID / Touch ID only (email codes removed).
--  • People who set up Face ID / Touch ID must use it on every sign-in.
--  • People who haven't set it up sign in with just their password.
--  • A leader can reset someone's Face ID / Touch ID (lost or new phone).
--  The database enforces it. Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════

-- Is this sign-in allowed in? Yes if the person has no Face ID / Touch ID set up,
-- or if this sign-in was confirmed with it.
create or replace function public.session_verified() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.passkeys where user_id = auth.uid())
      or public.this_session_confirmed()
$$;

-- What the app needs to know: does this person use Face ID, is this sign-in confirmed, how many devices.
create or replace function public.my_security() returns table (required boolean, verified boolean, passkeys int)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.passkeys where user_id = auth.uid()),
         public.this_session_confirmed(),
         (select count(*)::int from public.passkeys where user_id = auth.uid())
$$;

-- Leaders: who has Face ID / Touch ID set up, and resetting someone's.
create or replace function public.team_passkey_counts() returns table (user_id uuid, devices int)
language sql stable security definer set search_path = public as $$
  select p.user_id, count(*)::int from public.passkeys p where public.is_admin() group by p.user_id
$$;
create or replace function public.reset_passkeys(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only a leader can do that.'; end if;
  delete from public.passkeys where user_id = p_user;
  delete from public.passkey_challenges where user_id = p_user;
end $$;
revoke all on function public.team_passkey_counts() from public, anon;
revoke all on function public.reset_passkeys(uuid) from public, anon;
grant execute on function public.team_passkey_counts() to authenticated;
grant execute on function public.reset_passkeys(uuid) to authenticated;

-- Remove the email-code pieces.
drop function if exists public.set_require_2fa(boolean);
drop table if exists public.login_codes;
drop table if exists public.app_settings;


-- ═══════════════════════════════════════════════════════════════════
--  Update 8: let the sign-in server program (Face ID / Touch ID) use the
--  tables it needs. Newer Supabase projects don't grant this automatically.
--  Only the server program uses this account (its key never leaves Supabase).
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
grant select on public.profiles to service_role;
grant select, insert, update, delete on public.passkeys to service_role;
grant select, insert, update, delete on public.passkey_challenges to service_role;
grant select, insert, update on public.verified_sessions to service_role;
