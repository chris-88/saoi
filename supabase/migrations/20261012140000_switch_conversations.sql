-- One person, several conversations.
--
-- `participant_sessions` maps an auth user to a participant, and `session start` reads it with
-- `limit(1)` and no ordering. That was safe only because an auth user could never have more
-- than one row: the first call created the mapping and every call after it found the same one.
--
-- Switching conversations breaks that assumption — after it, a presenter's browser has a row
-- for every case they have opened — and an unordered `limit(1)` across several rows is a
-- conversation picked at random on each page load. `last_used_at` makes "the one you were last
-- in" a fact rather than whatever Postgres returns first.

alter table public.participant_sessions
  add column if not exists last_used_at timestamptz not null default now();

create index if not exists participant_sessions_recent_idx
  on public.participant_sessions (auth_user_id, last_used_at desc);

comment on column public.participant_sessions.last_used_at is
  'When this browser last had this conversation open. `session start` returns the most recent, which is what makes switching stick across a reload.';
