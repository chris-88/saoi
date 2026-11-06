-- The assistant's stored name is generic, so it survives any later rename of the product or the
-- persona.
--
-- 1. `messages.role` 'baz' becomes 'assistant' (check constraint, rows, and the by-day report).
-- 2. The catalogue product key `baz_usage` becomes `assistant_usage` in stored rows.
--
-- Safe on a database with no rows to change and on one with many; every statement is guarded by
-- its predicate, and the migration runner applies the file in one transaction.

alter table public.messages drop constraint messages_role_check;

update public.messages set role = 'assistant' where role = 'baz';

alter table public.messages
  add constraint messages_role_check check (role in ('customer', 'assistant', 'system'));

create or replace function public.messages_by_day(
  from_ts timestamptz,
  to_ts timestamptz
)
returns table (day date, role text, count bigint)
language sql
stable
as $$
  with days as (
    select generate_series(from_ts::date, to_ts::date, interval '1 day')::date as day
  ),
  roles as (
    select unnest(array['customer', 'assistant']) as role
  ),
  counted as (
    select m.created_at::date as day, m.role, count(*) as count
    from public.messages m
    where m.created_at >= from_ts
      and m.created_at < to_ts
      and m.role in ('customer', 'assistant')
    group by 1, 2
  )
  select days.day, roles.role, coalesce(counted.count, 0) as count
  from days
  cross join roles
  left join counted on counted.day = days.day and counted.role = roles.role
  order by days.day, roles.role;
$$;

update public.product_catalogue
set product = (product - 'baz_usage') || jsonb_build_object('assistant_usage', product -> 'baz_usage')
where product ? 'baz_usage';
