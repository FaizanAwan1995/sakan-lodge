begin;
-- Hold writes briefly so preservation checks compare the same ledger snapshot.
lock table public.people,public.payments,public.charges,public.audit in share row exclusive mode;
create temporary table tenant_account_preservation on commit drop as select
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.people p) people_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payments p) payments_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c) charges_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.audit a) audit_hash,
 (select md5(coalesce(jsonb_agg(jsonb_build_array(id,sakan_private.person_due(id)) order by id)::text,'[]')) from public.people) balances_hash;
-- Additive: no historical tenant, payment, charge or audit row is rewritten.
alter table public.people add column billing_schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(billing_schedule)='array');
alter table public.audit add column before_values jsonb, add column after_values jsonb, add column reason text;
create table sakan_private.account_requests (
 request_id uuid primary key, actor uuid not null, payload jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
alter table sakan_private.account_requests enable row level security;
revoke all on sakan_private.account_requests from public,anon,authenticated;

create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare rec jsonb; person uuid; person_name text;
begin
 rec:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='people' then person:=(rec->>'id')::uuid;person_name:=rec->>'name';
 elsif tg_table_name in ('charges','payments') then
  person:=(rec->>'person_id')::uuid;select name into person_name from public.people where id=person;
 end if;
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,before_values,after_values,reason)
 values(coalesce(auth.jwt()->>'email','system'),lower(tg_op)||' '||tg_table_name||coalesce(': '||person_name,''),person,person_name,tg_table_name,rec->>'id',
 case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end,nullif(current_setting('sakan.change_reason',true),''));
 return null;
end $$;

create function sakan_private.amend_tenant_details(p_id uuid,p_expected jsonb,p_changes jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform sakan_private.require_staff();
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason of at least five characters';end if;
 perform set_config('sakan.change_reason',trim(p_reason),true);
 return sakan_private.update_tenant_details(p_id,p_expected,p_changes);
end $$;
create function public.amend_tenant_details(p_id uuid,p_expected jsonb,p_changes jsonb,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select sakan_private.amend_tenant_details(p_id,p_expected,p_changes,p_reason)$$;

-- A request key represents one intentional operation. Network retries return the
-- first result; reusing that key with different input is rejected.
create function sakan_private.account_transaction(p_request uuid,p_person uuid,p_data jsonb,p_expected jsonb default null,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare p public.people; old_payment public.payments; saved public.payments; charge public.charges; cached sakan_private.account_requests;
 payload jsonb; result jsonb; amount numeric; kind text; day date; held numeric;
begin
 perform sakan_private.require_staff();
 if p_request is null then raise exception 'A request key is required';end if;
 payload:=jsonb_build_object('person',p_person,'data',p_data,'expected',p_expected,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into cached from sakan_private.account_requests where request_id=p_request;
 if found then
  if cached.actor<>auth.uid() or cached.payload is distinct from payload then raise exception 'Request key already used with different details';end if;
  return cached.result;
 end if;
 select * into p from public.people where id=p_person for update;
 if not found then raise exception 'Tenant not found';end if;
 amount:=(p_data->>'amount')::numeric;kind:=p_data->>'kind';day:=(p_data->>'date')::date;
 if amount is null or amount<=0 or amount<>round(amount,2) or amount>99999999 then raise exception 'Enter a positive amount with at most two decimal places';end if;
 if day is null or day>(now() at time zone 'Australia/Adelaide')::date then raise exception 'Transaction date cannot be in the future';end if;
 if kind is null or kind not in ('rent','bond','bond_refund','bond_deducted','charge') then raise exception 'Invalid transaction type';end if;
 if kind='charge' or p_expected is not null then
  if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A correction or charge needs a reason';end if;
 end if;
 perform set_config('sakan.change_reason',coalesce(trim(p_reason),''),true);
 if kind='charge' then
  if p_expected is not null then raise exception 'Charges are corrected with an adjustment, never overwritten';end if;
  insert into public.charges(person_id,kind,due_date,amount,note) values(p.id,'adjustment',day,amount,trim(p_reason)) returning * into charge;
  result:=to_jsonb(charge);
 else
  if p_data->>'method' is null or p_data->>'method' not in ('cash','transfer') then raise exception 'Choose cash or transfer';end if;
  if p_data->>'received_by' is null or p_data->>'received_by' not in ('Danish','Faizan','Joint account') then raise exception 'Choose who received the money';end if;
  if p_expected is not null then
   select * into old_payment from public.payments where id=(p_expected->>'id')::uuid and person_id=p.id for update;
   if not found or to_jsonb(old_payment) is distinct from p_expected then raise exception 'Payment changed. Reload before correcting it' using errcode='40001';end if;
  end if;
  -- Check the entire dated bond history after the proposed correction. A later
  -- receipt must not fund an earlier refund, or hide an invalid later refund.
  if kind in ('bond','bond_refund','bond_deducted') or old_payment.kind in ('bond','bond_refund','bond_deducted') then
  select min(balance) into held from (
   select sum(case when entries.kind='bond' then entries.amount else -entries.amount end) over(order by date) balance from (
    select pay.date,pay.kind,pay.amount from public.payments pay where pay.person_id=p.id and pay.kind in ('bond','bond_refund','bond_deducted') and (old_payment.id is null or pay.id<>old_payment.id)
    union all select day,kind,amount where kind in ('bond','bond_refund','bond_deducted')
   ) entries
  ) balances;
  if held < -0.005 then raise exception 'This would refund or retain more bond than recorded as received';end if;
  end if;
  if old_payment.id is null then
   insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note)
   values(p.id,p.property_id,day,amount,p_data->>'method',kind,p_data->>'received_by',p_data->>'note') returning * into saved;
  else
   update public.payments set date=day,amount=amount,method=p_data->>'method',kind=kind,received_by=p_data->>'received_by',note=p_data->>'note'
   where id=old_payment.id returning * into saved;
  end if;
  result:=to_jsonb(saved);
 end if;
 insert into sakan_private.account_requests(request_id,actor,payload,result) values(p_request,auth.uid(),payload,result);
 return result;
end $$;
create function public.account_transaction(p_request uuid,p_person uuid,p_data jsonb,p_expected jsonb default null,p_reason text default null) returns jsonb
language sql security invoker set search_path='' as $$select sakan_private.account_transaction(p_request,p_person,p_data,p_expected,p_reason)$$;

create function sakan_private.schedule_tenant_billing(p_id uuid,p_expected jsonb,p_effective date,p_weekly numeric,p_anchor date,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.people; terms jsonb; anchor date; today date:=(now() at time zone 'Australia/Adelaide')::date; last_day date;
begin
 perform sakan_private.require_staff();
 select * into p from public.people where id=p_id for update;
 if not found then raise exception 'Tenant not found';end if;
 if to_jsonb(p) is distinct from p_expected then raise exception 'Tenant changed. Reload before saving' using errcode='40001';end if;
 if p.stay_type<>'long' then raise exception 'Scheduled billing is for weekly rent accounts';end if;
 if p_effective is null or p_effective<=today or p_effective<=p.start_date or p_effective<=coalesce(p.paid_up_to,p.start_date) or p_effective>=coalesce(p.end_date,'infinity'::date) or p.checked_out_at is not null then raise exception 'Choose a future rent cycle within the stay';end if;
 if p_weekly is null or p_weekly<=0 or p_weekly<>round(p_weekly,2) then raise exception 'Enter a positive weekly rent with two decimal places';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Enter a reason';end if;
 select value into terms from jsonb_array_elements(p.billing_schedule) order by value->>'effective_from' desc limit 1;
 last_day:=(terms->>'effective_from')::date;
 if p_effective<=last_day then raise exception 'Choose a cycle after the last scheduled change';end if;
 select coalesce(case when terms is null then p.rent_cycle_anchor else (terms->>'rent_cycle_anchor')::date end,lease_anchor) into anchor from public.properties where id=p.property_id;
 if ((p_effective-anchor)%14+14)%14<>0 then raise exception 'Change must start at an existing rent cycle boundary';end if;
 perform set_config('sakan.change_reason',trim(p_reason),true);
 update public.people set billing_schedule=billing_schedule||jsonb_build_array(jsonb_build_object('effective_from',p_effective,'weekly_rate',p_weekly,'rent_cycle_anchor',p_anchor,'reason',trim(p_reason))) where id=p.id returning * into p;
 return to_jsonb(p);
end $$;
create function public.schedule_tenant_billing(p_id uuid,p_expected jsonb,p_effective date,p_weekly numeric,p_anchor date,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select sakan_private.schedule_tenant_billing(p_id,p_expected,p_effective,p_weekly,p_anchor,p_reason)$$;

create or replace function sakan_private.person_due(p_id uuid) returns numeric language plpgsql security definer set search_path='' as $$
declare p public.people; anchor date; today date:=(now() at time zone 'Australia/Adelaide')::date; s date; e date; nc date; pe date; total numeric:=0; first boolean:=true; amt numeric; terms jsonb; weekly numeric;
begin
 select * into p from public.people where id=p_id; select coalesce(p.rent_cycle_anchor,lease_anchor) into anchor from public.properties where id=p.property_id;
 if p.start_date<=today and not(p.checked_out_at is not null and (p.checked_out_at at time zone 'Australia/Adelaide')::date<p.start_date) then
 if p.stay_type in ('short','per_night') then
  if p.paid_up_to is null or p.paid_up_to<p.start_date then total:=coalesce(p.first_charge_amount,round(greatest(1,coalesce(p.end_date,p.start_date+1)-p.start_date)*coalesce(p.nightly_rate,0),2)); end if;
 else
  s:=greatest(coalesce(p.paid_up_to+1,p.start_date),p.start_date,'2026-07-01'::date); e:=coalesce(p.end_date,'infinity'::date);
  while s<e and s<=today loop
   select value into terms from jsonb_array_elements(p.billing_schedule) where (value->>'effective_from')::date<=s order by value->>'effective_from' desc limit 1;
   weekly:=coalesce((terms->>'weekly_rate')::numeric,p.weekly_rate);
   select coalesce(case when terms is null then p.rent_cycle_anchor else (terms->>'rent_cycle_anchor')::date end,lease_anchor) into anchor from public.properties where id=p.property_id;
   nc:=s+((anchor-s)%14+14)%14;
   pe:=least(case when nc>s then nc else s+14 end,e);
   if (nc>s or p.rent_cycle_anchor is not null) and first and p.paid_up_to is null and s=p.start_date and p.first_charge_amount is not null then amt:=p.first_charge_amount;
   else amt:=case when pe-s=14 then weekly*2 else floor((weekly/7*(pe-s))/5)*5 end; end if;
   total:=total+coalesce(amt,0);s:=pe;first:=false;
  end loop;
 end if;end if;
 if coalesce(p.opening_balance,0)>0 and coalesce(p.created_at::date,p.start_date)<=today then total:=total+p.opening_balance;end if;
 select total+coalesce(sum(amount),0) into total from public.charges where person_id=p.id and due_date<=today;
 select total-coalesce(sum(amount),0) into total from public.payments where person_id=p.id and coalesce(kind,'rent')='rent' and date<=today;
 return round(greatest(total,0),2);
end $$;

revoke all on function sakan_private.amend_tenant_details(uuid,jsonb,jsonb,text),public.amend_tenant_details(uuid,jsonb,jsonb,text),
sakan_private.account_transaction(uuid,uuid,jsonb,jsonb,text),public.account_transaction(uuid,uuid,jsonb,jsonb,text),
sakan_private.schedule_tenant_billing(uuid,jsonb,date,numeric,date,text),public.schedule_tenant_billing(uuid,jsonb,date,numeric,date,text) from public,anon,service_role;
grant execute on function sakan_private.amend_tenant_details(uuid,jsonb,jsonb,text),public.amend_tenant_details(uuid,jsonb,jsonb,text),
sakan_private.account_transaction(uuid,uuid,jsonb,jsonb,text),public.account_transaction(uuid,uuid,jsonb,jsonb,text),
sakan_private.schedule_tenant_billing(uuid,jsonb,date,numeric,date,text),public.schedule_tenant_billing(uuid,jsonb,date,numeric,date,text) to authenticated;
do $$
declare before_record record;
begin
 select * into before_record from tenant_account_preservation;
 if before_record.people_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p)-'billing_schedule' order by id)::text,'[]')) from public.people p)
 or before_record.payments_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payments p)
 or before_record.charges_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c)
 or before_record.audit_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(a)-'before_values'-'after_values'-'reason' order by id)::text,'[]')) from public.audit a)
 or before_record.balances_hash is distinct from (select md5(coalesce(jsonb_agg(jsonb_build_array(id,sakan_private.person_due(id)) order by id)::text,'[]')) from public.people)
 then raise exception 'Account migration preservation check failed: rolling back';end if;
end $$;
commit;
