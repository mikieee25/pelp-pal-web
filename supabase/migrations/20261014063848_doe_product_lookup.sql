create table if not exists public.official_product_records (
  control_number text primary key,
  record jsonb not null,
  source_url_hash text,
  fetched_at timestamptz not null default now()
);

create table if not exists public.doe_token_map (
  token_hash text primary key,
  control_number text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.doe_product_lookup_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  token_hash text not null,
  control_number text,
  created_at timestamptz not null default now()
);

alter table public.official_product_records enable row level security;
alter table public.doe_token_map enable row level security;
alter table public.doe_product_lookup_logs enable row level security;

create policy "Authenticated users can read official product records" on public.official_product_records for select to authenticated using (true);
create policy "Authenticated users can read DOE token mappings" on public.doe_token_map for select to authenticated using (true);

revoke all on table public.official_product_records from anon, authenticated;
revoke all on table public.doe_token_map from anon, authenticated;
revoke all on table public.doe_product_lookup_logs from anon, authenticated;
grant select on public.official_product_records to authenticated;
grant select on public.doe_token_map to authenticated;
grant all on public.official_product_records, public.doe_token_map, public.doe_product_lookup_logs to service_role;

create index if not exists doe_product_lookup_logs_account_created_idx on public.doe_product_lookup_logs (account_id, created_at);
create index if not exists doe_product_lookup_logs_token_created_idx on public.doe_product_lookup_logs (token_hash, created_at);
