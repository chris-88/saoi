-- A document the bank asked for after submission (§41).
--
-- The console's "ask for more information" now opens a real `application_requests` row, with
-- `requirement_id` prefixed `bank:` so it never collides with a journey's own ids, and the
-- customer answers it through the ordinary upload card. The file that arrives is recorded as
-- `bank_request`: whatever the bank asked for, which no journey file names. The check was
-- written when every document answered a journey requirement, and an insert against it was
-- the one write in the flow that would have failed loudly.

alter table public.documents drop constraint if exists documents_document_type_check;
alter table public.documents add constraint documents_document_type_check check (
  document_type in (
    'payslip', 'bank_statement', 'photo_id', 'proof_of_address', 'salary_certificate',
    'bank_request'
  )
);

comment on column public.application_requests.requirement_id is
  'A journey requirement id, or bank:<slug> for something the bank asked for after submission.';
