-- §44: the public form now takes a question as well as an offer to work on this. One table,
-- one column saying which, so the console can answer the questions and write to the rest.
alter table public.collaborators
  add column kind text not null default 'collaborate'
  check (kind in ('collaborate', 'question'));
