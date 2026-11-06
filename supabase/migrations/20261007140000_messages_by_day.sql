-- Conversation volume, which is messages rather than events (§9).
--
-- Nothing writes a `message_sent` event — a message is a row in `messages`, and adding an event
-- for each one would double the log to tell us something the log already holds. So the volume
-- chart reads the messages, and the admin function merges this into the same series as
-- `metrics_by_day` under the type `message`.
--
-- Split by role, because "how busy was it" and "how many people asked something" are different
-- questions and the second one is the interesting one.
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

revoke all on function public.messages_by_day(timestamptz, timestamptz) from public;
grant execute on function public.messages_by_day(timestamptz, timestamptz) to service_role;
