-- Recorded transactions are authoritative. Legacy paid flags without a receipt
-- remain distinguishable and are never turned into synthetic payments.
create function sakan_private.recorded_bond_status(p_person uuid,p_expected numeric,p_fallback text)
returns text language sql stable security definer set search_path='' as $$
 with totals as (
  select coalesce(sum(amount) filter(where kind='bond'),0) received,
   coalesce(sum(amount) filter(where kind='bond_refund'),0) refunded,
   coalesce(sum(amount) filter(where kind in ('bond_deducted','bond_applied')),0) retained
  from public.payments where person_id=p_person and date<=(now() at time zone 'Australia/Adelaide')::date
 )
 select case
  when received=0 then coalesce(p_fallback,'not_paid')
  when received-refunded-retained<=0.005 then case when retained>0 then 'deducted' else 'refunded' end
  when received+0.005>=coalesce(p_expected,0) then 'paid'
  else 'not_paid' end from totals;
$$;
revoke all on function sakan_private.recorded_bond_status(uuid,numeric,text) from public,anon,authenticated,service_role;

create function sakan_private.sync_payment_bond_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid; ids uuid[];
begin
 if tg_op='INSERT' then
  if new.kind not in ('bond','bond_refund','bond_deducted','bond_applied') then return new;end if;
  ids:=array[new.person_id];
 elsif tg_op='DELETE' then
  if old.kind not in ('bond','bond_refund','bond_deducted','bond_applied') then return old;end if;
  ids:=array[old.person_id];
 else
  if new.kind not in ('bond','bond_refund','bond_deducted','bond_applied') and old.kind not in ('bond','bond_refund','bond_deducted','bond_applied') then return new;end if;
  ids:=array[old.person_id,new.person_id];
 end if;
 for person in select distinct x from unnest(ids) x order by x loop
  update public.people p set bond_status=sakan_private.recorded_bond_status(p.id,p.bond,'not_paid')
  where p.id=person and p.bond_status is distinct from sakan_private.recorded_bond_status(p.id,p.bond,'not_paid');
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function sakan_private.sync_payment_bond_status() from public,anon,authenticated,service_role;
create trigger sync_recorded_bond_status after insert or update or delete on public.payments
for each row execute function sakan_private.sync_payment_bond_status();

create function sakan_private.guard_recorded_bond_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.bond_status:=sakan_private.recorded_bond_status(new.id,new.bond,new.bond_status);
 return new;
end $$;
revoke all on function sakan_private.guard_recorded_bond_status() from public,anon,authenticated,service_role;
create trigger guard_recorded_bond_status before update of bond,bond_status on public.people
for each row execute function sakan_private.guard_recorded_bond_status();

select set_config('sakan.change_reason','Reconcile stale bond status against recorded bond transactions; no payment or receipt changes.',true);
update public.people p set bond_status=sakan_private.recorded_bond_status(p.id,p.bond,p.bond_status)
where p.bond_status is distinct from sakan_private.recorded_bond_status(p.id,p.bond,p.bond_status);
