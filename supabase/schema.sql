-- SAKAN Lodge — run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lease_rent numeric not null,
  lease_anchor date not null,
  lease_start date,
  lease_end date,
  lease_first_amount numeric,
  electricity_cap numeric not null default 800,
  bills_amount numeric not null default 0,
  bills_frequency text not null default 'monthly' check (bills_frequency in ('monthly', 'yearly')),
  created_at timestamptz default now()
);

create table rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  label text not null,
  capacity int not null default 1 check (capacity between 1 and 3),
  sort int default 0
);

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  document_url text,
  document_notes text,
  property_id uuid not null references properties,
  room_id uuid references rooms on delete set null,
  stay_type text not null default 'long' check (stay_type in ('long','short','per_night')),
  weekly_rate numeric,
  nightly_rate numeric,
  start_date date not null,
  end_date date,
  paid_up_to date,
  opening_balance numeric not null default 0,
  first_charge_amount numeric,
  bond numeric not null default 0,
  bond_status text not null default 'not_paid' check (bond_status in ('not_paid','paid','refunded','deducted')),
  documents text[] not null default '{}',
  created_at timestamptz default now()
);

-- Only stored charges live here (electricity shares, adjustments). Rent is derived in the app.
create table charges (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people on delete cascade,
  kind text not null check (kind in ('rent','electricity','opening','adjustment')),
  period_start date, period_end date,
  due_date date not null,
  amount numeric not null,
  note text,
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people,
  property_id uuid not null references properties,
  date date not null,
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash','transfer','adjustment')),
  kind text not null default 'rent' check (kind in ('rent','bond','bond_refund','bond_deducted')),
  received_by text not null,
  note text,
  created_at timestamptz default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties, -- null = whole business
  date date not null,
  category text not null,
  amount numeric not null,
  note text,
  paid_from text not null default 'business' check (paid_from in ('business','personal')),
  reimbursed boolean not null default false,
  created_at timestamptz default now()
);

-- Operational repair queue. Repair costs are entered in expenses to avoid double-counting.
create table maintenance (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties on delete cascade,
  room_id uuid references rooms on delete set null,
  title text not null,
  details text,
  priority text not null default 'routine' check (priority in ('routine','soon','urgent')),
  status text not null default 'reported' check (status in ('reported','booked','waiting','complete')),
  reported_date date not null default current_date,
  due_date date,
  contractor text,
  contact text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index maintenance_open_followups on maintenance(status, due_date);

create table audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  by text,
  action text not null
);

-- Audit trail: every insert/update/delete, with who did it.
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; subject text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  subject := coalesce(rec ->> 'name', rec ->> 'label', nullif(concat_ws(' ', rec ->> 'kind', rec ->> 'category', rec ->> 'date', rec ->> 'amount'), ''));
  insert into audit(by, action)
  values (coalesce(auth.jwt() ->> 'email', 'system'),
          lower(tg_op) || ' ' || tg_table_name || coalesce(': ' || left(subject, 160), ''));
  return null;
end $$;

-- This is a trigger-only function; do not expose it as an RPC to API roles.
revoke execute on function public.log_change() from public, anon, authenticated;

do $$ declare t text;
begin
  foreach t in array array['properties','rooms','people','charges','payments','expenses','maintenance'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function log_change()', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy team_all on %I for all to authenticated using (true) with check (true)', t);
    execute format('alter publication supabase_realtime add table %I', t);
  end loop;
end $$;

alter table audit enable row level security;
create policy team_read on audit for select to authenticated using (true);
alter publication supabase_realtime add table audit;

-- Seed the portfolio (spec §2).
with p as (insert into properties(name, lease_rent, lease_anchor) values ('Fulham', 1500, '2026-09-02') returning id)
insert into rooms(property_id, label, capacity, sort)
select p.id, v.l, v.c, v.s from p, (values ('Granny flat',2,0),('Room 1',1,1),('Room 2',1,2),('Room 3',1,3),('Room 4',1,4)) v(l,c,s);

with p as (insert into properties(name, lease_rent, lease_anchor) values ('Oaklands Park', 1500, '2026-09-07') returning id)
insert into rooms(property_id, label, capacity, sort)
select p.id, v.l, v.c, v.s from p, (values ('Room 1',2,1),('Room 2',2,2),('Room 3',2,3),('Room 4',1,4),('Room 5',1,5),('Room 6',1,6),('Room 7',1,7)) v(l,c,s);

with p as (insert into properties(name, lease_rent, lease_anchor, lease_start, lease_first_amount) values ('Clapham', 1680, '2026-08-29', '2026-08-29', 1680) returning id)
insert into rooms(property_id, label, capacity, sort)
select p.id, v.l, v.c, v.s from p, (values ('Room 1 (ensuite)',3,1),('Room 2',1,2),('Room 3',1,3),('Room 4',1,4),('Room 5',1,5),('Room 6',1,6),('Room 7',1,7)) v(l,c,s);

with p as (insert into properties(name, lease_rent, lease_anchor) values ('Woodville', 1650, '2026-09-11') returning id)
insert into rooms(property_id, label, capacity, sort)
select p.id, v.l, v.c, v.s from p, (values ('Room 1',1,1),('Room 2',1,2),('Room 3',1,3),('Room 4',1,4),('Room 5',1,5),('Room 6',1,6)) v(l,c,s);
