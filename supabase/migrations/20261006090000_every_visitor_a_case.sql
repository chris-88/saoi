-- Every visitor gets their own case.
--
-- The `presenter` / `audience` split existed for a scripted demonstration: one rehearsed case
-- the presenter drove, and throwaway ones for everybody else. That shape works against a live
-- demonstration where the room invents the situation — there is no rehearsed case to join, and
-- the one the audience is watching is the one that matters.
--
-- `kind` stays, because a case the presenter is driving on screen is still worth marking, but
-- the values now describe what a case IS rather than who it was for.

alter table public.cases drop constraint if exists cases_kind_check;

alter table public.cases add constraint cases_kind_check check (
  kind in ('customer', 'presenter', 'audience')
);

-- Everything that exists becomes an ordinary customer case.
update public.cases set kind = 'customer' where kind in ('presenter', 'audience');

alter table public.cases alter column kind set default 'customer';

comment on column public.cases.kind is
  'Ordinarily `customer`. The legacy presenter/audience values are accepted so old rows load, but nothing writes them.';
