-- Track rent and bond cashflows separately. Bonds are liabilities, not income.
alter table payments
  add column if not exists kind text not null default 'rent';

alter table payments drop constraint if exists payments_kind_check;
alter table payments add constraint payments_kind_check
  check (kind in ('rent', 'bond', 'bond_refund', 'bond_deducted'));

alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('cash', 'transfer', 'adjustment'));

-- Keep the shared activity log useful without copying resident phone numbers or full records.
create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb; subject text;
begin
  rec := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  subject := coalesce(rec ->> 'name', rec ->> 'label',
    nullif(concat_ws(' ', rec ->> 'kind', rec ->> 'category', rec ->> 'date', rec ->> 'amount'), ''));
  insert into audit(by, action)
  values (coalesce(auth.jwt() ->> 'email', 'system'),
          lower(tg_op) || ' ' || tg_table_name || coalesce(': ' || left(subject, 160), ''));
  return null;
end $$;
