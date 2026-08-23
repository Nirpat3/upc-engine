-- UPC Engine: Supabase schema for the UPC database.
-- Run this in the Supabase SQL editor (or via `supabase db push` / psql)
-- against your project before using src/db.mjs.

create table if not exists upc_records (
  upc_a           text primary key
                    constraint upc_records_upc_a_format check (upc_a ~ '^[0-9]{12}$'),
  number_system   text not null,
  company_prefix  text,
  item_reference  text,
  check_digit     text not null,
  brand_name      text,
  product_name    text,
  source_profile  text,
  raw_input       text,
  metadata        jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  seen_count      integer not null default 1
);

create index if not exists upc_records_brand_name_idx on upc_records (brand_name);
create index if not exists upc_records_company_prefix_idx on upc_records (company_prefix);
create index if not exists upc_records_last_seen_at_idx on upc_records (last_seen_at desc);

-- Atomic seen_count increment + first_seen_at preservation on upsert.
-- PostgREST's on_conflict=merge-duplicates does a plain column overwrite,
-- so it can't do "seen_count = seen_count + 1" itself -- this trigger does.
create or replace function upc_records_track_seen()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' then
    new.seen_count := old.seen_count + 1;
    new.first_seen_at := old.first_seen_at; -- never let an upsert clobber the original first-seen time
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_upc_records_track_seen on upc_records;
create trigger trg_upc_records_track_seen
  before update on upc_records
  for each row execute function upc_records_track_seen();

-- Optional: brand/company-prefix reference table, so createBrandProfile()
-- output (src/decompose.mjs) has somewhere durable to live and future
-- decomposeUpcA() calls for that brand can look up companyPrefixLength
-- instead of having it passed in every time.
create table if not exists brand_profiles (
  company_prefix        text primary key
                           constraint brand_profiles_prefix_format check (company_prefix ~ '^[0-9]{6,10}$'),
  brand_name            text not null,
  company_prefix_length integer not null check (company_prefix_length between 6 and 10),
  notes                 text,
  created_at            timestamptz not null default now()
);

-- Row Level Security: enabled but permissive-by-default for the service
-- role (which bypasses RLS entirely). If you plan to query this table from
-- a browser/anon client, add explicit policies here first.
alter table upc_records enable row level security;
alter table brand_profiles enable row level security;
