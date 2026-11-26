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
