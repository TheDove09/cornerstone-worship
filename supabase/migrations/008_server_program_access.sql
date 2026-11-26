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
