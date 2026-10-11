-- Shared repair follow-up queue for both partners.
create table if not exists maintenance (
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
create index if not exists maintenance_open_followups on maintenance(status, due_date);

alter table maintenance enable row level security;
drop policy if exists team_all on maintenance;
create policy team_all on maintenance for all to authenticated using (true) with check (true);
drop trigger if exists audit_maintenance on maintenance;
create trigger audit_maintenance after insert or update or delete on maintenance
  for each row execute function log_change();
alter publication supabase_realtime add table maintenance;
