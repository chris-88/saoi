-- The partner invite does not expire (§6 Stage 9, §33).
--
-- A second applicant opens the link when they get to it: that evening, at the weekend, from a
-- different phone than the one they first read it on. A link that died after a day, or after
-- one tap, was failing them for being normal. `expires_at` becomes nullable, and null means the
-- link does not expire. Handoff codes and notification links keep their short TTLs: they are
-- used by the person who just made them, in the next minute.
alter table public.tokens alter column expires_at drop not null;
