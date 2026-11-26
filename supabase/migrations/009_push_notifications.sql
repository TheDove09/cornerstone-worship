-- ═══════════════════════════════════════════════════════════════════
--  Update 9: phone notifications.
--  Each phone that turns on notifications gets one row here. Only the
--  sign-in server program reads or writes it (it checks who is asking).
--  Safe to run more than once.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.push_subscriptions (
  endpoint     text primary key,               -- the phone's private delivery address (from Apple/Google)
  user_id      uuid not null references auth.users(id) on delete cascade,
  p256dh       text not null,                  -- the phone's public key: notifications are encrypted for it
  auth         text not null,
  device       text not null default '',
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;   -- no policies: people can't read others' phones

grant select, insert, update, delete on public.push_subscriptions to service_role;
grant select on public.messages to service_role;
