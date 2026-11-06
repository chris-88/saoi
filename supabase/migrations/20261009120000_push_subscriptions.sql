-- ---------------------------------------------------------------------------
-- Web Push subscriptions (§35, §42)
--
-- One row per browser that has granted permission. A participant can have
-- several: a phone, an installed PWA and a laptop are three subscriptions to
-- the same person, and all three should get the notification.
--
-- The endpoint is the push service's own URL and is unique per browser, so it
-- is the natural key — resubscribing the same browser replaces the row rather
-- than accumulating duplicates that would each deliver a copy.
--
-- No client writes. Subscriptions arrive through an Edge Function under the
-- service role, like everything else (Invariant 2).
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  endpoint text not null unique,
  -- The browser's public key and auth secret, from the Push API subscription.
  -- Both are base64url and both are needed to encrypt a payload it can open.
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  -- Set when the push service reports the subscription is gone (404/410), so a
  -- dead endpoint is not retried forever.
  expired_at timestamptz
);

create index push_subscriptions_case_idx on public.push_subscriptions (case_id)
  where expired_at is null;

alter table public.push_subscriptions enable row level security;

-- No policies: reads and writes go through Edge Functions under the service
-- role. A client that could read these could send itself notifications.
