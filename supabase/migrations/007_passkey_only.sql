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
