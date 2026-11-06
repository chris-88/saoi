-- A daily series, which every chart on the analytics screen needs and nothing produced (§9).
--
-- Metrics were `count(*) group by type` over the last five thousand events. That answers "how
-- many" and cannot answer "how many each day", and it quietly stops being true once the log
-- passes the cap. This answers both, over a window, without loading the rows into Deno.
--
-- `generate_series` fills the gaps: a day with no conversations is a zero in the series, not a
-- missing point, and a line chart that closes over its quiet days is a lie about the shape.
create or replace function public.metrics_by_day(
  from_ts timestamptz,
  to_ts timestamptz,
  types text[] default null
)
returns table (day date, type text, count bigint)
language sql
stable
as $$
  with days as (
    select generate_series(from_ts::date, to_ts::date, interval '1 day')::date as day
  ),
  kinds as (
    select distinct e.type
    from public.events e
    where e.created_at >= from_ts
      and e.created_at < to_ts
      and (types is null or e.type = any(types))
  ),
  counted as (
    select e.created_at::date as day, e.type, count(*) as count
    from public.events e
    where e.created_at >= from_ts
      and e.created_at < to_ts
      and (types is null or e.type = any(types))
    group by 1, 2
  )
  select days.day, kinds.type, coalesce(counted.count, 0) as count
  from days
  cross join kinds
  left join counted on counted.day = days.day and counted.type = kinds.type
  order by days.day, kinds.type;
$$;

-- Read through the `admin` Edge Function on the service role, like every other metric. Nothing
-- in the browser calls this directly.
revoke all on function public.metrics_by_day(timestamptz, timestamptz, text[]) from public;
grant execute on function public.metrics_by_day(timestamptz, timestamptz, text[]) to service_role;
