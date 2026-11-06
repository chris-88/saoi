-- The Goal Engine: a plan's goal becomes a catalogue blueprint id.
--
-- `plans.goal` held nine values invented alongside the plans feature. The goal catalogue defines
-- twenty-six, and the overlap is poor enough to matter: the seven goals the catalogue marks as
-- the demonstration priorities (§20) include `shared_household_finances`, `prepare_for_baby`,
-- `family_protection` and `rebuild_savings_after_home_purchase`, none of which could be recorded
-- at all. A plan filed under the nearest wrong heading is worse than no plan.
--
-- Three of the old values are renamed rather than dropped, so existing plans survive.

update public.plans set goal = 'build_emergency_fund' where goal = 'emergency_fund';
update public.plans set goal = 'renovate_home'        where goal = 'renovate';
update public.plans set goal = 'prepare_for_retirement' where goal = 'retire';
update public.plans set goal = 'reduce_debt'          where goal = 'become_debt_free';

alter table public.plans drop constraint if exists plans_goal_check;

alter table public.plans add constraint plans_goal_check check (
  goal in (
    'organise_day_to_day_finances', 'build_emergency_fund', 'reduce_debt',
    'save_for_defined_purchase', 'rebuild_savings_after_home_purchase',
    'buy_first_home', 'move_home', 'renovate_home',
    'shared_household_finances', 'prepare_for_baby', 'save_for_child',
    'family_protection', 'income_resilience',
    'start_career', 'deal_with_income_change', 'financial_difficulty_recovery',
    'separate_finances',
    'manage_lump_sum', 'start_investing',
    'start_pension', 'prepare_for_retirement', 'transition_to_retirement',
    'fund_education', 'buy_car',
    'move_to_ireland', 'international_money',
    -- Not in the catalogue, and kept deliberately: an objective does not have to be one of
    -- twenty-six, and `other` carries no blueprint so it carries no milestones either.
    'other'
  )
);

comment on column public.plans.goal is
  'A goal blueprint id from _shared/domain/goals/catalogue.ts, or `other`.';

-- A milestone that is reached once the case can answer a set of questions.
--
-- Most milestones in the catalogue read "affordability understood", "debts understood",
-- "equity position understood". That is not something anybody ticks — it is whether the
-- information exists. Binding them to fact keys keeps plan progress computed from what has
-- actually been collected, the same rule the requirement engine follows (Invariant 3), instead
-- of waiting for somebody to mark it by hand.
alter table public.plan_milestones drop constraint if exists plan_milestones_kind_check;

alter table public.plan_milestones add constraint plan_milestones_kind_check check (
  kind in ('numeric', 'date', 'application', 'facts', 'customer', 'external')
);

alter table public.plan_milestones
  add column if not exists target_facts jsonb;

comment on column public.plan_milestones.target_facts is
  'For `facts` milestones: the fact keys the case must be able to answer. Null otherwise.';
