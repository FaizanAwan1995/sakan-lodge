-- The existing property editor already offers these optional budget fields.
-- Add missing production columns without rewriting resident or transaction records.
begin;
alter table public.properties add column if not exists bills_amount numeric not null default 0;
alter table public.properties add column if not exists bills_frequency text not null default 'monthly';
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.properties'::regclass and conname='property_budget_amount_valid') then
  alter table public.properties add constraint property_budget_amount_valid check(bills_amount>=0 and bills_amount<'Infinity'::numeric and bills_amount=round(bills_amount,2));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.properties'::regclass and conname='property_budget_frequency_valid') then
  alter table public.properties add constraint property_budget_frequency_valid check(bills_frequency in ('monthly','yearly'));
 end if;
end$$;

-- STABLE uses the calling statement's MVCC snapshot for every table below.
-- Return a single JSON document so Data API row limits cannot truncate transactions.
create function public.ledger_snapshot() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_sakan_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 return jsonb_build_object(
  'properties',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.properties p),
  'rooms',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.rooms r),
  'people',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.people p),
  'charges',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]'::jsonb) from public.charges c),
  'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.payments p),
  'expenses',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from public.expenses e),
  'maintenance',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]'::jsonb) from public.maintenance m),
  'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by at desc,id desc),'[]'::jsonb) from (select * from public.audit order by at desc,id desc limit 300) a)
 );
end $$;
revoke all on function public.ledger_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.ledger_snapshot() to authenticated;
commit;
