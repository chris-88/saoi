-- An audit trail for the admin API's destructive actions, and the transactions around them.
--
-- `delete_case` and `purge_cases` used to leave nothing behind: `events` rows are per case and
-- cascade away with it, so the record of the deletion would be deleted by the deletion. This
-- table has no foreign key to `cases` for the same reason. It is written by the same
-- transaction as the delete, so there is never a deletion without a row, nor a row without a
-- deletion.
--
-- The functions below are what makes reset, delete and purge atomic: supabase-js cannot hold a
-- transaction open across calls, but a function is one. They are called by saoi-api's store with
-- the service role and by nobody else (execute is revoked from the API roles).

create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- The admin's auth user. No foreign key: a purge may sweep users, and the trail must outlive them.
  admin_user_id uuid not null,
  action text not null check (action in ('reset_case', 'delete_case', 'purge_cases')),
  -- The case acted on. No foreign key, see above. Null for a purge.
  case_id uuid,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_at_idx on public.admin_audit (at desc);

alter table public.admin_audit enable row level security;
comment on table public.admin_audit is
  'Destructive admin actions. Service-role only: RLS denies all rows to anon and authenticated.';

-- Deletes one case (everything under it cascades) and records who did it, atomically.
-- Returns false, writing nothing, when there is no such case.
create or replace function public.admin_delete_case(p_case uuid, p_admin uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  found_kind text;
begin
  select kind into found_kind from public.cases where id = p_case;
  if not found then
    return false;
  end if;
  delete from public.cases where id = p_case;
  insert into public.admin_audit (admin_user_id, action, case_id, detail)
  values (p_admin, 'delete_case', p_case, jsonb_build_object('kind', found_kind));
  return true;
end;
$$;

-- Deletes every case and records it, atomically. Returns how many went. The auth-user sweep
-- that follows is outside the database and cannot join this transaction; its count is added to
-- the same audit row afterwards by `admin_audit_note`.
create or replace function public.admin_purge_cases(p_admin uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed integer;
  audit_id uuid;
begin
  with gone as (delete from public.cases where true returning id)
  select count(*) into removed from gone;
  insert into public.admin_audit (admin_user_id, action, detail)
  values (p_admin, 'purge_cases', jsonb_build_object('cases', removed))
  returning id into audit_id;
  return jsonb_build_object('purged', removed, 'auditId', audit_id);
end;
$$;

create or replace function public.admin_audit_note(p_audit uuid, p_detail jsonb)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.admin_audit set detail = detail || p_detail where id = p_audit;
$$;

-- Replaces a case with the canonical presenter case, atomically: the named case is deleted,
-- the customer upserted, the new case, its primary participant and its bank-held facts
-- created, a `case_reset` event written, and the audit row recorded. All or nothing, so a
-- failure part way no longer leaves the presenter with no case at all.
--   p_customer: { bank_reference, full_name, date_of_birth, email, mobile, existing_products }
--   p_facts:    [{ key, household (bool), value, source, verified }]
create or replace function public.admin_reset_case(
  p_case uuid,
  p_admin uuid,
  p_label text,
  p_first_name text,
  p_customer jsonb,
  p_facts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  customer_id uuid;
  new_case uuid;
  participant_id uuid;
  fact_count integer;
begin
  if not exists (select 1 from public.cases where id = p_case) then
    return null;
  end if;
  delete from public.cases where id = p_case;

  insert into public.customers (bank_reference, full_name, date_of_birth, email, mobile, existing_products)
  values (
    p_customer ->> 'bank_reference',
    p_customer ->> 'full_name',
    (p_customer ->> 'date_of_birth')::date,
    p_customer ->> 'email',
    p_customer ->> 'mobile',
    array(select jsonb_array_elements_text(p_customer -> 'existing_products'))
  )
  on conflict (bank_reference) do update set
    full_name = excluded.full_name,
    date_of_birth = excluded.date_of_birth,
    email = excluded.email,
    mobile = excluded.mobile,
    existing_products = excluded.existing_products
  returning id into customer_id;

  insert into public.cases (kind, label, customer_id, auth_level)
  values ('presenter', p_label, customer_id, 'authenticated')
  returning id into new_case;

  insert into public.participants (case_id, role, display_name)
  values (new_case, 'primary', p_first_name)
  returning id into participant_id;

  insert into public.facts (case_id, key, participant_id, subject_kind, value, source, verified)
  select
    new_case,
    f ->> 'key',
    case when (f ->> 'household')::boolean then null else participant_id end,
    case when (f ->> 'household')::boolean then 'household' else 'participant' end,
    f -> 'value',
    f ->> 'source',
    (f ->> 'verified')::boolean
  from jsonb_array_elements(p_facts) as f;
  get diagnostics fact_count = row_count;

  insert into public.events (case_id, type, actor, payload)
  values (new_case, 'case_reset', 'admin', jsonb_build_object('facts', fact_count));

  insert into public.admin_audit (admin_user_id, action, case_id, detail)
  values (p_admin, 'reset_case', p_case, jsonb_build_object('replacedBy', new_case, 'facts', fact_count));

  return jsonb_build_object('caseId', new_case, 'facts', fact_count);
end;
$$;

revoke all on function public.admin_delete_case(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_purge_cases(uuid) from public, anon, authenticated;
revoke all on function public.admin_audit_note(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_reset_case(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.admin_delete_case(uuid, uuid) to service_role;
grant execute on function public.admin_purge_cases(uuid) to service_role;
grant execute on function public.admin_audit_note(uuid, jsonb) to service_role;
grant execute on function public.admin_reset_case(uuid, uuid, text, text, jsonb, jsonb) to service_role;
