-- Defence in depth for the four tables that deliberately have no read policy.
--
-- RLS already denies every row on these, but the SELECT grant remains, so PostgREST still
-- treats them as readable relations. Revoking the grant means a policy added here by mistake
-- in future still would not expose them, and the intent is visible at the grant level too.
--
--   customers            synthetic bank records, loaded server-side on authentication
--   participant_sessions the auth-user-to-participant mapping
--   tokens               opaque single-use secrets, even hashed (§58, Invariant 8)
--   admin_users          the admin roster
--
-- Edge Functions reach these with the service role, which bypasses both grants and RLS.

revoke all on public.customers from anon, authenticated;
revoke all on public.participant_sessions from anon, authenticated;
revoke all on public.tokens from anon, authenticated;
revoke all on public.admin_users from anon, authenticated;

-- Supabase's default privileges would re-grant these to any table created later, so this is
-- scoped to the four tables above rather than altering defaults for the whole schema.
