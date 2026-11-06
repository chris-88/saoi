-- What each turn actually consumed (console §4).
--
-- Every Anthropic response reports exactly what it used, so this is measured rather than
-- modelled — the estimate is in the prices, which are a constant in `domain/cost.ts`, not in
-- the token counts. One row per Saoirse message holds the whole turn: every tool round of the model
-- call, plus the gate that ran in front of it.
--
-- Nullable because every message written before this existed has no usage to record, and a
-- zero there would read as a turn that cost nothing rather than one nobody measured.
alter table public.messages add column usage jsonb;

comment on column public.messages.usage is
  'Measured token usage for the whole turn: { model: {...}, gate: {...} }. Null for turns that predate cost tracking.';
