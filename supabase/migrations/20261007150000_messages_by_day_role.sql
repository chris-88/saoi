-- The assistant's role in `messages` is `baz`, not `assistant`.
--
-- The previous version counted a role that does not exist, so the "Saoirse replied" line sat at zero
-- on a chart whose other line was not — which is worse than no chart, because it reads as a
-- finding rather than as a bug.
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
    select unnest(array['customer', 'baz']) as role
  ),
  counted as (
    select m.created_at::date as day, m.role, count(*) as count
    from public.messages m
    where m.created_at >= from_ts
      and m.created_at < to_ts
      and m.role in ('customer', 'baz')
    group by 1, 2
  )
  select days.day, roles.role, coalesce(counted.count, 0) as count
  from days
  cross join roles
  left join counted on counted.day = days.day and counted.role = roles.role
  order by days.day, roles.role;
$$;
