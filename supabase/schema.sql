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
