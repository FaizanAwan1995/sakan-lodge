begin;
alter table public.people add column checked_out_at timestamptz;
-- Physical departure is distinct from the billing boundary, preserving the
-- existing minimum-night charge for same-day departures without blocking a bed.
do $$declare src text;begin
 select pg_get_functiondef('sakan_private.free_spaces(uuid,date,date,uuid,uuid,uuid)'::regprocedure) into src;
 src:=replace(src,'coalesce(p.end_date,''infinity''::date) e','least(coalesce(p.end_date,''infinity''::date),coalesce((p.checked_out_at at time zone ''Australia/Adelaide'')::date,''infinity''::date)) e');
 src:=replace(src,'where s<p_end and e>p_start','where s<e and s<p_end and e>p_start'); execute src;
 select pg_get_functiondef('sakan_private.guard_inventory()'::regprocedure) into src;
 src:=replace(src,'new.start_date,new.end_date)','new.start_date,new.end_date,new.checked_out_at)');
 src:=replace(src,'old.start_date,old.end_date)','old.start_date,old.end_date,old.checked_out_at)');
 src:=replace(src,'  free:=sakan_private.free_spaces(rid,s,e,null,new.id);','  if new.checked_out_at is not null then
    if new.checked_out_at>now() then raise exception ''Actual checkout cannot be in the future''; end if;
    e:=least(e,(new.checked_out_at at time zone ''Australia/Adelaide'')::date);
    if e<=s then return new; end if;
  end if;
  free:=sakan_private.free_spaces(rid,s,e,null,new.id);'); execute src;
end $$;
create function sakan_private.person_due(p_id uuid) returns numeric language plpgsql security definer set search_path='' as $$
declare p public.people; anchor date; today date:=(now() at time zone 'Australia/Adelaide')::date; s date; e date; nc date; pe date; total numeric:=0; first boolean:=true; amt numeric;
begin
 select * into p from public.people where id=p_id; select lease_anchor into anchor from public.properties where id=p.property_id;
 if p.start_date<=today and not(p.checked_out_at is not null and (p.checked_out_at at time zone 'Australia/Adelaide')::date<p.start_date) then
 if p.stay_type in ('short','per_night') then
  if p.paid_up_to is null or p.paid_up_to<p.start_date then total:=coalesce(p.first_charge_amount,round(greatest(1,coalesce(p.end_date,p.start_date+1)-p.start_date)*coalesce(p.nightly_rate,0),2)); end if;
 else
  s:=greatest(coalesce(p.paid_up_to+1,p.start_date),p.start_date,'2026-07-01'::date); e:=coalesce(p.end_date,'infinity'::date);
  while s<e and s<=today loop
   nc:=s+((anchor-s)%14+14)%14;
   pe:=least(case when nc>s then nc else s+14 end,e);
   if nc>s and first and p.paid_up_to is null and s=p.start_date and p.first_charge_amount is not null then amt:=p.first_charge_amount;
   else amt:=case when pe-s=14 then p.weekly_rate*2 else floor((p.weekly_rate/7*(pe-s))/5)*5 end; end if;
   total:=total+coalesce(amt,0);s:=pe;first:=false;
  end loop;
 end if;end if;
 if coalesce(p.opening_balance,0)>0 and coalesce(p.created_at::date,p.start_date)<=today then total:=total+p.opening_balance;end if;
 select total+coalesce(sum(amount),0) into total from public.charges where person_id=p.id and due_date<=today;
 select total-coalesce(sum(amount),0) into total from public.payments where person_id=p.id and coalesce(kind,'rent')='rent' and date<=today;
 return round(greatest(total,0),2);
end $$;
create function sakan_private.admin_tenant_action(p_id uuid,p_action text,p_amount numeric,p_reason text,p_expected numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.people; due numeric; today date:=(now() at time zone 'Australia/Adelaide')::date; actor text:=auth.uid()::text;
begin
 perform sakan_private.require_staff();
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Resident not found';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason of at least five characters';end if;
 if p_action='checkout_now' then
  if p.checked_out_at is not null then raise exception 'Resident already checked out';end if;
  update public.people set checked_out_at=now(),end_date=greatest(today,start_date+1) where id=p.id returning * into p;
 elsif p_action<>'clear_balance' then raise exception 'Unknown tenant action'; end if;
 due:=sakan_private.person_due(p.id);
 if p_action='clear_balance' then
  if due is distinct from p_expected then raise exception 'Balance changed. Reload before clearing';end if;
  if p_amount is null or p_amount<=0 or p_amount>due or round(p_amount,2)<>p_amount or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Adjustment must be within the outstanding balance';end if;
  insert into public.charges(person_id,kind,due_date,amount,note) values(p.id,'adjustment',today,-p_amount,'Admin balance credit: '||trim(p_reason)||' | by '||actor);
 end if;
 insert into public.audit("by",action) values(actor,p_action||' for '||p.name||'; reason: '||trim(p_reason)||case when p_action='clear_balance' then '; credit AUD '||p_amount else '; outstanding AUD '||due end);
 return jsonb_build_object('person',to_jsonb(p),'owed',sakan_private.person_due(p.id));
end $$;
create function public.admin_tenant_action(p_id uuid,p_action text,p_amount numeric default null,p_reason text default null,p_expected numeric default null) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.admin_tenant_action(p_id,p_action,p_amount,p_reason,p_expected)$$;
revoke all on function sakan_private.person_due(uuid),sakan_private.admin_tenant_action(uuid,text,numeric,text,numeric),public.admin_tenant_action(uuid,text,numeric,text,numeric) from public,anon,service_role;
grant execute on function sakan_private.admin_tenant_action(uuid,text,numeric,text,numeric),public.admin_tenant_action(uuid,text,numeric,text,numeric) to authenticated;
-- Serialise credits with all receipts/charges for the same account.
create function sakan_private.lock_person_finance() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform id from public.people where id=old.person_id for update; return old;end if;
 if tg_op='UPDATE' then perform id from public.people where id in (old.person_id,new.person_id) order by id for update;
 else perform id from public.people where id=new.person_id for update;end if;return new;
end $$;
revoke all on function sakan_private.lock_person_finance() from public,anon,authenticated,service_role;
create trigger lock_charge_person before insert or update or delete on public.charges for each row execute function sakan_private.lock_person_finance();
create trigger lock_payment_person before insert or update or delete on public.payments for each row execute function sakan_private.lock_person_finance();
commit;
