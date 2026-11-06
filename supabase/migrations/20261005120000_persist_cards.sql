-- Cards are part of the turn, not decoration.
--
-- Without this, reloading showed the conversation text but none of the cards, so the customer
-- lost the options they were offered and the model — which does read history — would refer to
-- a card that was no longer on screen.

alter table public.messages
  add column cards jsonb not null default '[]'::jsonb;

comment on column public.messages.cards is
  'The cards rendered alongside this turn, so a reload restores the whole turn (§59).';
