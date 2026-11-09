-- Market data from more than one source.
--
-- A row was read either from the provider's own website (`bank`) or from the Competition and
-- Consumer Protection Commission's comparison tables (`ccpc`). The same product can have a row
-- from each, side by side, each with its own history, so the two can be compared. `provider` is
-- always the bank, whichever source the row came from.
--
-- New columns, all describing where a row came from and what it lacks:
--   source             bank | ccpc
--   provider_url       the provider's own page for the product, where the source links one
--   source_product_id  the source's id for the product (CCPC's numeric id)
--   source_updated_at  when the source says it last edited the record (CCPC, for some kinds)
--   attribution        what has to travel with the row under the source's re-use terms
--   unknown            fields Saoi needs that the source does not give, so their absence is
--                      never read as zero
--
-- The categories widen to the ones CCPC compares: credit cards and current accounts.
alter table public.market_products
  add column source text not null default 'bank' check (source in ('bank', 'ccpc')),
  add column provider_url text check (provider_url is null or provider_url ~ '^https://'),
  add column source_product_id text,
  add column source_updated_at timestamptz,
  add column attribution text,
  add column unknown text[] not null default '{}';

alter table public.market_products drop constraint market_products_category_check;
alter table public.market_products add constraint market_products_category_check
  check (category in ('savings', 'deposit', 'mortgage', 'loan', 'credit_card', 'current_account'));

drop index public.market_products_current;
create unique index market_products_current
  on public.market_products (provider, source, product_id)
  where superseded_at is null;

drop index public.market_products_history;
create index market_products_history
  on public.market_products (provider, source, product_id, first_seen_at);

-- One refresh of one provider from one source, all or nothing. Replaces the three-argument
-- version: the source is part of what a row is.
drop function public.market_record_refresh(text, jsonb, text[]);

create or replace function public.market_record_refresh(
  p_provider text,
  p_source text,
  p_products jsonb,
  p_retired text[] default '{}'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  item jsonb;
  current_row public.market_products%rowtype;
  confirmed text[] := '{}';
  versioned text[] := '{}';
  added text[] := '{}';
  retired text[] := '{}';
  checked timestamptz;
  item_unknown text[];
begin
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then
    raise exception 'market_record_refresh: no products for % from %', p_provider, p_source;
  end if;

  for item in select * from jsonb_array_elements(p_products) loop
    checked := (item ->> 'checked_at')::timestamptz;
    item_unknown := coalesce(
      (select array_agg(value order by value) from jsonb_array_elements_text(item -> 'unknown')),
      '{}'
    );

    -- No row lock: the partial unique index allows one current row per product and source, so a
    -- second refresh running at the same moment fails on insert and rolls back whole.
    select * into current_row
      from public.market_products
     where provider = p_provider
       and source = p_source
       and product_id = item ->> 'product_id'
       and superseded_at is null;

    if found
       and current_row.category = item ->> 'category'
       and current_row.provider_product_name = item ->> 'provider_product_name'
       and current_row.rates = item -> 'rates'
       and current_row.conditions = item -> 'conditions'
       and current_row.source_url = item ->> 'source_url'
       and current_row.provider_url is not distinct from item ->> 'provider_url'
       and current_row.source_product_id is not distinct from item ->> 'source_product_id'
       and current_row.source_updated_at is not distinct from (item ->> 'source_updated_at')::timestamptz
       and current_row.attribution is not distinct from item ->> 'attribution'
       and current_row.unknown = item_unknown
       and current_row.effective_from is not distinct from (item ->> 'effective_from')::date then
      update public.market_products set checked_at = checked where id = current_row.id;
      confirmed := confirmed || (item ->> 'product_id');
      continue;
    end if;

    if found then
      update public.market_products set superseded_at = checked where id = current_row.id;
      versioned := versioned || (item ->> 'product_id');
    else
      added := added || (item ->> 'product_id');
    end if;

    insert into public.market_products (
      provider, source, product_id, category, provider_product_name, rates, conditions,
      source_url, provider_url, source_product_id, source_updated_at, attribution, unknown,
      effective_from, first_seen_at, checked_at
    ) values (
      p_provider,
      p_source,
      item ->> 'product_id',
      item ->> 'category',
      item ->> 'provider_product_name',
      item -> 'rates',
      item -> 'conditions',
      item ->> 'source_url',
      item ->> 'provider_url',
      item ->> 'source_product_id',
      (item ->> 'source_updated_at')::timestamptz,
      item ->> 'attribution',
      item_unknown,
      (item ->> 'effective_from')::date,
      checked,
      checked
    );
  end loop;

  with gone as (
    update public.market_products
       set superseded_at = now()
     where provider = p_provider
       and source = p_source
       and product_id = any (coalesce(p_retired, '{}'))
       and superseded_at is null
    returning product_id
  )
  select coalesce(array_agg(product_id), '{}') into retired from gone;

  return jsonb_build_object(
    'confirmed', to_jsonb(confirmed),
    'versioned', to_jsonb(versioned),
    'added', to_jsonb(added),
    'retired', to_jsonb(retired)
  );
end;
$$;

revoke all on function public.market_record_refresh(text, text, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.market_record_refresh(text, text, jsonb, text[]) to service_role;
