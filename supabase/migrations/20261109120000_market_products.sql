-- Market data: what a provider publishes about the products Saoi models, read off its public
-- website by `npm run market:refresh` (scripts/market/refresh.ts). Bank of Ireland only for now.
--
-- History is kept: a row is one version of one provider product. A refresh that finds the same
-- rates and conditions moves `checked_at` on the current row; one that finds anything different
-- supersedes the current row and inserts a new one, so an old rate is never overwritten. A
-- product that has gone from the site is superseded with no successor. The current state is the
-- rows with `superseded_at is null`, at most one per provider product.
--
-- `rates` and `conditions` are the JSON shapes in `_shared/market/schema.ts`, validated there
-- before they are written and again when the API reads them. A table rather than a file in the
-- image because the API image is built from git: a rate change should land with a refresh, not
-- with a deploy.
--
-- `product_id` is the catalogue id Saoi models the product as (`savings.supersaver`). The
-- provider is its own column, so another bank's products slot in beside these without any
-- stored id changing.
create table public.market_products (
  id bigint generated always as identity primary key,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  product_id text not null check (product_id ~ '^[a-z_]+(\.[a-z0-9_]+)+$'),
  category text not null check (category in ('savings', 'deposit', 'mortgage', 'loan')),
  provider_product_name text not null check (length(btrim(provider_product_name)) > 0),
  rates jsonb not null,
  conditions jsonb not null,
  source_url text not null check (source_url ~ '^https://'),
  -- The date the rate took effect, where the page says.
  effective_from date,
  -- When this version was first seen, and when a page last confirmed it.
  first_seen_at timestamptz not null default now(),
  checked_at timestamptz not null,
  superseded_at timestamptz,
  check (superseded_at is null or superseded_at >= first_seen_at)
);

create unique index market_products_current
  on public.market_products (provider, product_id)
  where superseded_at is null;

create index market_products_history on public.market_products (provider, product_id, first_seen_at);

-- Read and written on the service role only (the API, and the refresh script). No policy, and
-- the grants are revoked below, as for the other internal tables.
alter table public.market_products enable row level security;

-- One refresh, all or nothing.
--
-- p_products is an array of objects with the columns above (provider is the argument). Every
-- product is confirmed or versioned; p_retired names product ids that have gone from the site.
-- Returns what it did: { "confirmed": [...], "versioned": [...], "added": [...], "retired": [...] }.
create or replace function public.market_record_refresh(
  p_provider text,
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
begin
  if jsonb_typeof(p_products) <> 'array' or jsonb_array_length(p_products) = 0 then
    raise exception 'market_record_refresh: no products for %', p_provider;
  end if;

  for item in select * from jsonb_array_elements(p_products) loop
    checked := (item ->> 'checked_at')::timestamptz;

    select * into current_row
      from public.market_products
     where provider = p_provider
       and product_id = item ->> 'product_id'
       and superseded_at is null;
    -- No row lock: the partial unique index allows one current row per product, so a second
    -- refresh running at the same moment fails on insert and rolls back whole.

    if found
       and current_row.category = item ->> 'category'
       and current_row.provider_product_name = item ->> 'provider_product_name'
       and current_row.rates = item -> 'rates'
       and current_row.conditions = item -> 'conditions'
       and current_row.source_url = item ->> 'source_url'
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
      provider, product_id, category, provider_product_name, rates, conditions,
      source_url, effective_from, first_seen_at, checked_at
    ) values (
      p_provider,
      item ->> 'product_id',
      item ->> 'category',
      item ->> 'provider_product_name',
      item -> 'rates',
      item -> 'conditions',
      item ->> 'source_url',
      (item ->> 'effective_from')::date,
      checked,
      checked
    );
  end loop;

  with gone as (
    update public.market_products
       set superseded_at = now()
     where provider = p_provider
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

revoke all on public.market_products from anon, authenticated;
revoke all on function public.market_record_refresh(text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.market_record_refresh(text, jsonb, text[]) to service_role;
