begin;
lock table public.people,public.payments,public.charges,public.audit in share row exclusive mode;
create temporary table stay_preservation on commit drop as select
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.people p) people_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.payments p) payments_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c) charges_hash,
 (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.audit a) audit_hash,
 (select coalesce(max(id),0) from public.audit) audit_max,
 (select md5(coalesce(jsonb_agg(jsonb_build_array(id,sakan_private.person_due(id)) order by id)::text,'[]')) from public.people) balances_hash;
alter table public.payments add column settlement_id uuid;
alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check(kind in ('rent','bond','bond_refund','bond_deducted','bond_applied'));
alter table public.payments add constraint bond_applied_settlement_check check(kind<>'bond_applied' or (settlement_id is not null and method='adjustment'));
create index payment_settlement on public.payments(settlement_id) where settlement_id is not null;

-- A bond allocation reduces rent debt and bond liability, without inventing cash.
do $$declare definition text;begin
 select pg_get_functiondef('sakan_private.person_due(uuid)'::regprocedure) into definition;
 definition:=replace(definition,$find$coalesce(kind,'rent')='rent'$find$, $replace$coalesce(kind,'rent') in ('rent','bond_applied')$replace$);
 execute definition;
 select pg_get_functiondef('sakan_private.account_transaction(uuid,uuid,jsonb,jsonb,text)'::regprocedure) into definition;
 definition:=replace(definition,$find$('bond','bond_refund','bond_deducted')$find$, $replace$('bond','bond_refund','bond_deducted','bond_applied')$replace$);
 definition:=replace(definition,'if not found or to_jsonb(old_payment) is distinct from p_expected then', 'if old_payment.settlement_id is not null then raise exception ''Settlement entries cannot be overwritten. Reconcile through an audited adjustment'';end if; if not found or to_jsonb(old_payment) is distinct from p_expected then');
 execute definition;
end $$;

create function sakan_private.protect_bond_settlement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' and old.settlement_id is not null then raise exception 'Bond settlement history cannot be overwritten or deleted';end if;
 if tg_op<>'DELETE' and (new.kind='bond_applied' or new.settlement_id is not null) and nullif(current_setting('sakan.bond_settlement',true),'') is distinct from new.settlement_id::text then raise exception 'Use the atomic bond settlement action';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function sakan_private.protect_bond_settlement() from public,anon,authenticated,service_role;
create trigger protect_bond_settlement before insert or update or delete on public.payments for each row execute function sakan_private.protect_bond_settlement();

create function sakan_private.settle_tenant_bond(p_request uuid,p_person uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.people; cached sakan_private.account_requests; payload jsonb; result jsonb; held numeric; due numeric; applied numeric; refunded numeric; day date:=(now() at time zone 'Australia/Adelaide')::date; reason text; applied_id uuid; refund_id uuid;
begin
 perform sakan_private.require_staff();
 if p_request is null then raise exception 'Request key required';end if;
 payload:=jsonb_build_object('operation','settle_bond','person',p_person,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into cached from sakan_private.account_requests where request_id=p_request;
 if found then
  if cached.actor<>auth.uid() or cached.payload is distinct from payload then raise exception 'Request key already used with different details';end if;
  return cached.result;
 end if;
 select * into person from public.people where id=p_person for update;
 if not found then raise exception 'Tenant not found';end if;
 applied:=(p_data->>'apply_amount')::numeric;refunded:=(p_data->>'refund_amount')::numeric;reason:=trim(p_data->>'reason');
 if applied is null or refunded is null or applied<0 or refunded<0 or applied+refunded<=0 or applied<>round(applied,2) or refunded<>round(refunded,2) or applied::text in ('NaN','Infinity','-Infinity') or refunded::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter valid amounts with at most two decimal places';end if;
 if length(coalesce(reason,''))<5 then raise exception 'Enter a settlement reason';end if;
 if p_data->>'handled_by' is null or p_data->>'handled_by' not in ('Faizan','Danish','Joint account') then raise exception 'Choose the administrator handling settlement';end if;
 if p_data->>'method' is null or p_data->>'method' not in ('cash','transfer') then raise exception 'Choose the actual refund method';end if;
 select coalesce(sum(case when kind='bond' then amount when kind in ('bond_refund','bond_deducted','bond_applied') then -amount else 0 end),0) into held from public.payments where person_id=person.id and date<=day;
 due:=sakan_private.person_due(person.id);
 if held is distinct from (p_data->>'expected_held')::numeric or due is distinct from (p_data->>'expected_owed')::numeric then raise exception 'Account balance changed. Refresh before settling' using errcode='40001';end if;
 if applied>due then raise exception 'Amount applied cannot exceed outstanding rent and charges';end if;
 if applied+refunded>held then raise exception 'Settlement exceeds recorded bond held. Reconcile the original receipt first';end if;
 perform set_config('sakan.change_reason',reason,true);
 perform set_config('sakan.bond_settlement',p_request::text,true);
 if applied>0 then
  insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,settlement_id)
  values(person.id,person.property_id,day,applied,'adjustment','bond_applied',p_data->>'handled_by',reason,p_request) returning id into applied_id;
 end if;
 if refunded>0 then
  insert into public.payments(person_id,property_id,date,amount,method,kind,received_by,note,settlement_id)
  values(person.id,person.property_id,day,refunded,p_data->>'method','bond_refund',p_data->>'handled_by',reason,p_request) returning id into refund_id;
 end if;
 result:=jsonb_build_object('applied',applied,'refunded',refunded,'bond_held',held-applied-refunded,'owed',sakan_private.person_due(person.id),'settlement_id',p_request,'applied_id',applied_id,'refund_id',refund_id,'date',day);
 insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,before_values,after_values,reason)
 values(auth.uid()::text,'bond_settled',person.id,person.name,'bond_settlement',p_request::text,jsonb_build_object('bond_held',held,'owed',due),result,reason);
 insert into sakan_private.account_requests(request_id,actor,payload,result) values(p_request,auth.uid(),payload,result);
 return result;
end $$;
create function public.settle_tenant_bond(p_request uuid,p_person uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select sakan_private.settle_tenant_bond(p_request,p_person,p_data)$$;
revoke all on function sakan_private.settle_tenant_bond(uuid,uuid,jsonb),public.settle_tenant_bond(uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function sakan_private.settle_tenant_bond(uuid,uuid,jsonb),public.settle_tenant_bond(uuid,uuid,jsonb) to authenticated;

-- One append-only record per tenant and scheduled departure date. This records
-- elapsed scheduled occupancy, never confirmation that a person physically left.
create unique index audit_scheduled_checkout_once on public.audit(tenant_id,(after_values->>'end_date')) where action='scheduled_checkout_elapsed';
create function sakan_private.record_elapsed_checkouts() returns integer language plpgsql security definer set search_path='' as $$
declare person public.people; added integer:=0; n integer;
begin
 for person in select * from public.people where checked_out_at is null and end_date<=(now() at time zone 'Australia/Adelaide')::date order by id for update loop
  insert into public.audit("by",action,tenant_id,tenant_name,entity_table,entity_id,after_values,reason)
  values('system','scheduled_checkout_elapsed',person.id,person.name,'people',person.id::text,to_jsonb(person),'Scheduled occupancy elapsed automatically. Physical departure has not been confirmed; recorded now from saved stay dates.') on conflict do nothing;
  get diagnostics n=row_count;added:=added+n;
 end loop;
 return added;
end $$;
revoke all on function sakan_private.record_elapsed_checkouts() from public,anon,authenticated,service_role;
-- Existing stay dates are preserved. Missing old events remain explicitly unknown.
select sakan_private.record_elapsed_checkouts();
-- History search must not silently lose older audit records after 300 entries.
do $$declare definition text;begin
 select pg_get_functiondef('public.ledger_snapshot()'::regprocedure) into definition;
 definition:=replace(definition,'order by at desc,id desc limit 300','order by at desc,id desc');
 execute definition;
end $$;
do $$declare before_record record;begin
 select * into before_record from stay_preservation;
 if before_record.people_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from public.people p)
 or before_record.payments_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p)-'settlement_id' order by id)::text,'[]')) from public.payments p)
 or before_record.charges_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.charges c)
 or before_record.audit_hash is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(a) order by id)::text,'[]')) from public.audit a where id<=before_record.audit_max)
 or before_record.balances_hash is distinct from (select md5(coalesce(jsonb_agg(jsonb_build_array(id,sakan_private.person_due(id)) order by id)::text,'[]')) from public.people)
 then raise exception 'Stay history preservation check failed: rolling back';end if;
end $$;
commit;
