-- Answers given to a digital form that are not Saoirse facts.
--
-- Most of what a form wants is something Saoirse already holds, or should: a name, an income, an
-- address. Those live in `facts` and are mapped into whatever form needs them, which is what
-- makes the same answer serve every product.
--
-- The rest is form-specific and belongs to the form. "Do you use online banking?" is not a fact
-- about a person worth carrying between products. Neither is a declaration whose wording is
-- particular to one lending application. Those are recorded here, against the form application
-- they were given for, and they never pretend to be anything more general than that.
--
-- Consent is the reason this table carries wording and a participant. A confirmation is only
-- meaningful if there is a record of exactly what was agreed, by whom and when, and a checkbox
-- value of "Yes" with no wording beside it is not evidence of anything (§10 of the feature
-- note, Invariant 6).

create table if not exists public.form_answers (
  id uuid primary key default gen_random_uuid(),
  form_application_id uuid not null references public.form_applications(id) on delete cascade,
  -- The definition's own field id, e.g. "167" or "48".
  field_id text not null,
  value jsonb not null,
  -- How it got here. `consent` is a deliberate act, `document` is an upload reference.
  source text not null check (source in ('customer', 'consent', 'document')),
  -- The exact text shown at the moment of agreeing. Null for an ordinary answer.
  wording text,
  participant_id uuid references public.participants(id) on delete set null,
  answered_at timestamptz not null default now(),
  unique (form_application_id, field_id)
);

create index if not exists form_answers_application_idx
  on public.form_answers (form_application_id);

alter table public.form_answers enable row level security;

-- Readable by whoever can read the case it belongs to, through the form application.
create policy form_answers_read on public.form_answers
  for select using (
    exists (
      select 1
      from public.form_applications fa
      where fa.id = form_answers.form_application_id
        and public.can_read_case(fa.case_id)
    )
  );

comment on table public.form_answers is
  'Answers given directly to a digital form, including consents with the wording agreed to. Facts live in `facts`; this is what is particular to one form.';
